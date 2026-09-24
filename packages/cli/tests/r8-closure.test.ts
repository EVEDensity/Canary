import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ControlPlane } from "@canary/control-plane";
import { ExperienceStore } from "@canary/experience";
import { FileArtifactRepository, writePrivateJson } from "@canary/trace";
import { executeCi } from "../src/ci.js";
import { main, runCommandDetailed } from "../src/index.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

async function command(args: string[]) {
  const values: string[] = [], original = console.log;
  console.log = (...items) => values.push(items.map(String).join(" "));
  try { return { code: await main(args), body: JSON.parse(values.at(-1) ?? "null") as any }; }
  finally { console.log = original; }
}

describe("R8 verified project experience closure", () => {
  it("moves a sealed project failure through isolated replay, control approval, actual load and exact rollback", async () => {
    const preserve = process.env.CANARY_R8_PRESERVE === "1";
    const fixtureParent = preserve ? join(process.cwd(), "..", "..", ".canary", "verification", "r8") : tmpdir();
    if (preserve) mkdirSync(fixtureParent, { recursive: true });
    const root = mkdtempSync(join(fixtureParent, "canary-r8-closure-"));
    if (!preserve) roots.push(root);
    const agentConfig = join(root, "agent.config.ts"), projectConfig = join(root, "canary.project.json");
    const source = "export default async (input, ctx) => ctx.experiences.length ? { value: input } : input === 'broken' ? null : { value: input };";
    writeFileSync(join(root, "agent.mjs"), source);
    writeFileSync(join(root, "cases.ts"), "export default [{ id: 'broken', input: 'broken', assertions: [{ type: 'output.exists' }] }, { id: 'holdout', input: 'holdout', tags: ['holdout'], dataset: { split: 'holdout', version: 'r8' }, assertions: [{ type: 'output.exists' }] }];");
    writeFileSync(agentConfig, "export default { agent: { adapter: 'function', entry: './agent.mjs' }, cases: './cases.ts', coverage: { include: ['agent.mjs'], exclude: [] }, web: { enabled: false } };");
    writeFileSync(projectConfig, JSON.stringify({ kind: "canary.project", version: 1, checks: [{ id: "workspace.agent", type: "agent", config: "agent.config.ts" }] }));
    const sourceFiles = ["agent.mjs", "cases.ts", "agent.config.ts", "canary.project.json"].map((name) => readFileSync(join(root, name), "utf8"));
    const artifacts = new FileArtifactRepository(join(root, ".canary", "artifacts"));
    const baseline = await executeCi(["--ci", "--config", projectConfig], runCommandDetailed);
    expect(baseline.exitCode).toBe(1);
    const baselineId = JSON.parse(readFileSync(baseline.artifactPath!, "utf8")).runId as string;
    expect(artifacts.verify(baselineId).status).toBe("verified");
    const baselineRun = artifacts.readRun(baselineId)!;
    const childId = baselineRun.checks?.[0]?.childRun?.runId;
    expect(childId).toBeTruthy();
    expect(artifacts.verify(baselineId).status).toBe("verified");
    expect((await command(["experience", "propose-project", baselineId, "--config", projectConfig])).code).toBe(0);
    const experienceStore = new ExperienceStore(join(root, ".canary", "experiences"));
    const experience = experienceStore.list()[0]!;
    expect(experience.status).toBe("proposed");
    expect(experience.scope.caseIds).toEqual(["broken"]);
    const negative = experienceStore.propose({ key: "project:workspace.agent:wrong-scope", projectRoot: experience.projectRoot, source: experience.source, summary: experience.summary, content: experience.content, scope: { ...experience.scope, caseIds: ["holdout"] }, provenance: experience.provenance, limitations: experience.limitations, validationRequirements: experience.validationRequirements });
    const rejected = await command(["soft-trial", "prepare", childId!, "--experience", negative.id, "--regression", "broken", "--holdout", "holdout", "--config", agentConfig]);
    expect(rejected.code).toBe(1);
    expect(rejected.body.errors[0]).toMatch(/scoped regression/);
    const plane = new ControlPlane(experience.projectRoot);
    expect(plane.execute({ action: "experience.revoke", target: negative.id, expectedRevision: plane.revision("experience.revoke", negative.id), requestId: "r8_negative_rejection", actor: "operator", reason: "Regression case falls outside the proposed scope" }, { role: "operator" }).status).toBe("completed");
    expect(experienceStore.get(negative.id)?.status).toBe("revoked");
    const prepared = await command(["soft-trial", "prepare", childId!, "--experience", experience.id, "--regression", "broken", "--holdout", "holdout", "--config", agentConfig]);
    expect(prepared.code).toBe(0);
    const trialId = prepared.body.record.id as string;
    expect((await command(["soft-trial", "run", trialId, "--config", agentConfig])).code).toBe(1);
    const validated = await command(["soft-trial", "validate", trialId, "--config", agentConfig]);
    expect(validated.code, JSON.stringify(validated.body.record.validation.reasons)).toBe(0);
    expect(validated.body.record.validation.valid).toBe(true);
    expect(() => plane.assertSoftApproval(trialId)).toThrow(/requires control-plane approval evidence/);
    expect((await command(["soft-trial", "approve", trialId, "--actor", "operator", "--reason", "reviewed", "--config", agentConfig])).code).toBe(1);
    const action = { action: "soft.approve" as const, target: trialId, expectedRevision: plane.revision("soft.approve", trialId), requestId: "r8_approval", actor: "operator", reason: "regression and holdout evidence reviewed" };
    expect(plane.execute(action, { role: "operator" }).status).toBe("completed");
    const activated = await command(["soft-trial", "run", trialId, "--config", agentConfig]);
    expect(activated.code).toBe(0);
    expect(activated.body.loadedExperienceIds).toContain(experience.id);
    const nextRun = artifacts.readRun(activated.body.record.nextRunId)!;
    expect(nextRun.experiences?.[0]?.selection?.caseIds).toEqual(["broken"]);
    const exported = await command(["experience", "export-skill", experience.id, "--config", agentConfig]);
    expect(exported.code, JSON.stringify(exported.body.errors)).toBe(0);
    const draft = readFileSync(exported.body.path, "utf8");
    expect(draft).toContain("name: canary-");
    expect(draft).toContain(experience.provenance!.manifestHash);
    expect(draft).not.toContain("sk-");
    expect((await command(["experience", "export-skill", experience.id, "--config", agentConfig])).body.metadata.skillHash).toBe(exported.body.metadata.skillHash);
    writeFileSync(exported.body.path, `${draft}\nchanged after export\n`);
    expect((await command(["experience", "export-skill", experience.id, "--config", agentConfig])).code).toBe(1);
    writeFileSync(exported.body.path, draft);
    const projectAfter = await executeCi(["--ci", "--config", projectConfig], runCommandDetailed);
    expect(projectAfter.exitCode).toBe(0);
    const projectAfterId = JSON.parse(readFileSync(projectAfter.artifactPath!, "utf8")).runId as string;
    const projectChild = artifacts.readRun(artifacts.readRun(projectAfterId)!.checks![0]!.childRun!.runId)!;
    expect(projectChild.experiences?.some((item) => item.id === experience.id && item.selection?.caseIds?.includes("broken"))).toBe(true);
    const dashboard = plane.snapshot();
    expect(dashboard.experiences.find((item) => item.id === experience.id)).toMatchObject({ status: "active", provenance: { runId: baselineId, checkId: "workspace.agent" }, lastLoadedRunId: expect.any(String) });
    expect(dashboard.experiences.find((item) => item.id === negative.id)).toMatchObject({ status: "revoked" });
    expect(dashboard.trials.find((item) => item.id === trialId)).toMatchObject({ comparison: { verdict: "improve", regressions: [] }, validation: { valid: true } });
    expect(dashboard.actions).toContainEqual(expect.objectContaining({ action: "soft.rollback", target: trialId }));
    expect(JSON.stringify(dashboard)).not.toContain(experience.content);
    expect((await command(["soft-trial", "rollback", trialId, "--config", agentConfig])).code).toBe(1);
    const rollback = { action: "soft.rollback" as const, target: trialId, expectedRevision: plane.revision("soft.rollback", trialId), requestId: "r8_rollback", actor: "operator", reason: "restore exact prior pointer" };
    expect(plane.execute(rollback, { role: "operator" }).status).toBe("completed");
    expect((await command(["experience", "export-skill", experience.id, "--config", agentConfig])).code).toBe(1);
    expect(new ExperienceStore(join(root, ".canary", "experiences")).activePointer(experience.projectRoot).entries).toEqual([]);
    const afterRollback = await executeCi(["--ci", "--config", projectConfig], runCommandDetailed);
    expect(afterRollback.exitCode).toBe(1);
    const rollbackRunId = JSON.parse(readFileSync(afterRollback.artifactPath!, "utf8")).runId as string;
    const rollbackChild = artifacts.readRun(artifacts.readRun(rollbackRunId)!.checks![0]!.childRun!.runId)!;
    expect(rollbackChild.experiences).toEqual([]);
    expect(["agent.mjs", "cases.ts", "agent.config.ts", "canary.project.json"].map((name) => readFileSync(join(root, name), "utf8"))).toEqual(sourceFiles);
    expect(artifacts.verify(projectAfterId).status).toBe("verified");
    expect(artifacts.verify(activated.body.record.nextRunId).status).toBe("verified");
    expect(artifacts.verify(rollbackRunId).status).toBe("verified");
    if (preserve) writePrivateJson(join(root, "acceptance.json"), {
      v: 1, kind: "canary.r8-acceptance", fixture: "local-function-agent", baseline: { runId: baselineId, manifestHash: artifacts.verify(baselineId).manifestHash }, negativeProposal: { id: negative.id, rejected: true, auditId: "r8_negative_rejection", reason: rejected.body.errors[0] }, candidate: { experienceId: experience.id, trialId, runId: validated.body.record.validation.candidateRunId, valid: true }, approval: { auditId: "r8_approval", actor: "operator", reason: "regression and holdout evidence reviewed" }, activated: { runId: activated.body.record.nextRunId, projectRunId: projectAfterId, loaded: true }, rollback: { auditId: "r8_rollback", runId: rollbackRunId, loaded: false }, sourceHash: createHash("sha256").update(sourceFiles.join("\n")).digest("hex"), sourceUnchanged: true, modelInvocations: 0,
    });
  }, 80_000);
});
