import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectCheckResult, RunSnapshot } from "@canary/core";
import { projectChecksConfigSchema } from "@canary/core";
import { ExperienceStore } from "@canary/experience";
import { beginArtifacts, FileArtifactRepository, sealArtifacts, writePrivateJson } from "@canary/trace";
import { main } from "../src/index.js";
import { executeCi } from "../src/ci.js";
import { runCommandDetailed } from "../src/index.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("R8 project experience CLI", () => {
  it("uses real project check processes for the baseline and candidate", async () => {
    const root = mkdtempSync(join(tmpdir(), "canary-r8-real-")); roots.push(root);
    const config = join(root, "canary.project.json");
    writeFileSync(config, JSON.stringify({ kind: "canary.project", version: 1, checks: [
      { id: "build", type: "command", command: "node", args: ["-e", "process.exit(0)"] },
      { id: "test", type: "command", command: "node", args: ["test.mjs"], dependsOn: ["build"] },
      { id: "holdout", type: "command", command: "node", args: ["-e", "process.exit(0)"], dependsOn: ["build"] },
    ] }));
    const testFile = join(root, "test.mjs");
    writeFileSync(testFile, "process.stderr.write('Error: fixture assertion failed\\n'); process.exit(1);");
    const baseline = await executeCi(["--ci", "--config", config], runCommandDetailed);
    expect(baseline.exitCode).toBe(1);
    const baseRunId = JSON.parse(readFileSync(baseline.artifactPath!, "utf8")).runId as string;
    expect(await main(["experience", "propose-project", baseRunId, "--check", "test", "--config", config])).toBe(0);
    writeFileSync(testFile, "process.exit(0);");
    const candidate = await executeCi(["--ci", "--config", config], runCommandDetailed);
    expect(candidate.exitCode).toBe(0);
    const candidateRunId = JSON.parse(readFileSync(candidate.artifactPath!, "utf8")).runId as string;
    expect(await main(["experience", "compare-project", baseRunId, candidateRunId, "--regression", "test", "--holdout", "holdout", "--config", config])).toBe(0);
    const repository = new FileArtifactRepository(join(root, ".canary", "artifacts"));
    expect(repository.readJson<{ verdict: string; attribution: { status: string } }>(candidateRunId, "project-comparison.json")).toMatchObject({ verdict: "improve", attribution: { status: "unverified" } });
    expect(repository.verify(candidateRunId).status).toBe("verified");
  }, 20_000);

  it("proposes only from sealed failure evidence and records an offline comparison in the manifest", async () => {
    const root = mkdtempSync(join(tmpdir(), "canary-r8-cli-")); roots.push(root);
    const config = join(root, "canary.project.json");
    const plan = projectChecksConfigSchema.parse({ kind: "canary.project", version: 1, checks: [
      { id: "build", type: "command", command: "node", args: ["build.mjs"] },
      { id: "test", type: "command", command: "node", args: ["test.mjs"], dependsOn: ["build"] },
      { id: "holdout", type: "command", command: "node", args: ["holdout.mjs"], dependsOn: ["build"] },
    ] });
    writeFileSync(config, JSON.stringify(plan));
    const artifactRoot = join(root, ".canary", "artifacts");
    mkdirSync(artifactRoot, { recursive: true });
    const repository = new FileArtifactRepository(artifactRoot);
    function save(id: string, testPassed: boolean) {
      const checks: ProjectCheckResult[] = plan.checks.map((item) => ({ id: item.id, type: item.type, version: 1, required: true, status: item.id === "test" && !testPassed ? "failed" : "passed", evidence: "verified", category: item.id === "test" && !testPassed ? "assertion" : "none", exitCode: item.id === "test" && !testPassed ? 1 : 0, retryable: false, durationMs: 10, cwd: root, envAllowlist: [], command: "node" }));
      const run: RunSnapshot = { runId: id, status: testPassed ? "completed" : "failed", startedAt: "2026-09-24T00:00:00.000Z", totalCases: 3, completedCases: 3, passedCases: checks.filter((item) => item.status === "passed").length, results: [], events: [], checks };
      const dir = join(artifactRoot, id);
      beginArtifacts(dir);
      writePrivateJson(join(dir, "check-plan.json"), plan);
      writePrivateJson(join(dir, "run.json"), run);
      sealArtifacts(dir);
    }
    save("run_base", false); save("run_candidate", true);
    expect(await main(["experience", "propose-project", "run_base", "--config", config])).toBe(0);
    const store = new ExperienceStore(join(root, ".canary", "experiences"));
    expect(store.list()).toMatchObject([{ status: "proposed", provenance: { runId: "run_base", checkId: "test", manifestHash: expect.stringMatching(/^[a-f0-9]{64}$/) } }]);
    expect(await main(["experience", "propose-project", "run_base", "--config", config])).toBe(0);
    expect(store.list()).toHaveLength(1);
    expect(await main(["experience", "compare-project", "run_base", "run_candidate", "--regression", "test", "--holdout", "holdout", "--config", config])).toBe(0);
    expect(repository.verify("run_candidate").status).toBe("verified");
    const report = repository.readJson<{ verdict: string; admissible: boolean; reportHash: string }>("run_candidate", "project-comparison.json");
    expect(report).toMatchObject({ verdict: "improve", admissible: false, reportHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    const comparisonManifestHash = repository.verify("run_candidate").manifestHash;
    expect(await main(["experience", "compare-project", "run_base", "run_candidate", "--regression", "test", "--holdout", "holdout", "--config", config])).toBe(0);
    expect(repository.readJson("run_candidate", "project-comparison.json")).toEqual(report);
    expect(repository.verify("run_candidate").manifestHash).toBe(comparisonManifestHash);
    expect(await main(["experience", "validate", store.list()[0]!.id, "--config", config])).toBe(1);
    expect(await main(["experience", "activate", store.list()[0]!.id, "--config", config])).toBe(1);
    expect(readFileSync(join(root, ".canary", "experiences", "records", `${store.list()[0]!.id}.json`), "utf8")).not.toContain("approved");
    writeFileSync(join(artifactRoot, "run_base", "run.json"), "{");
    expect(await main(["experience", "propose-project", "run_base", "--config", config])).toBe(1);
  });
});
