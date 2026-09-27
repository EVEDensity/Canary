import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EvalResult, ProjectCheckResult, RunSnapshot } from "@canary/core";
import { projectChecksConfigSchema } from "@canary/core";
import { beginArtifacts, sealArtifacts, writePrivateJson, FileArtifactRepository, RunStore } from "@canary/trace";
import { WorkspaceReader } from "../src/workspace.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "canary-issues-"));
  roots.push(root);
  const repo = new FileArtifactRepository(root),
    store = new RunStore();
  const plan = projectChecksConfigSchema.parse({
    kind: "canary.project",
    version: 1,
    checks: [
      { id: "build", type: "command", command: "node", args: ["build.mjs"] },
      { id: "test", type: "command", command: "node", args: ["test.mjs"], dependsOn: ["build"] },
    ],
  });
  let sequence = 0;
  function save(
    id: string,
    status: RunSnapshot["status"],
    parent?: string,
    options: {
      plan?: typeof plan;
      missingBuild?: boolean;
      missingTest?: boolean;
      partial?: boolean;
      wrongHash?: boolean;
    } = {},
  ) {
    const lineage = parent
      ? { retryOf: parent, parentManifestHash: options.wrongHash ? "0".repeat(64) : repo.verify(parent).manifestHash! }
      : {};
    const selected = options.plan ?? plan;
    const checks: ProjectCheckResult[] = selected.checks
      .filter((c) => !(options.missingBuild && c.id === "build") && !(options.missingTest && c.id === "test"))
      .map((c) => ({
        id: c.id,
        type: c.type,
        version: 1,
        required: true,
        status: c.id === "test" && status === "failed" ? "failed" : "passed",
        evidence: "verified",
        category: c.id === "test" && status === "failed" ? "assertion" : "none",
        exitCode: c.id === "test" && status === "failed" ? 1 : 0,
        retryable: false,
        durationMs: 10,
        cwd: root,
        envAllowlist: [],
        stderr: c.id === "test" && status === "failed" ? "Error: src/sample.ts:12:3" : "",
      }));
    const run: RunSnapshot = {
      runId: id,
      status,
      startedAt: new Date(Date.UTC(2026, 8, 21, 0, 0, sequence++)).toISOString(),
      totalCases: selected.checks.length,
      completedCases: checks.length,
      passedCases: checks.filter((c) => c.status === "passed").length,
      results: [],
      events: [],
      checks,
      ...(parent ? { retryOf: parent } : {}),
      evidence: {
        v: 1,
        lineage,
        reproduction: {
          configHash: "fixture",
          casesHash: "fixture",
          sourceHash: "fixture",
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          lockfiles: {},
          environmentHash: "fixture",
          environmentNames: [],
          mode: "recorded",
        },
      },
    };
    const dir = join(root, id);
    beginArtifacts(dir, lineage);
    writePrivateJson(join(dir, "check-plan.json"), selected);
    writePrivateJson(join(dir, "run.json"), run);
    if (!options.partial) sealArtifacts(dir);
    return run;
  }
  save("run_original", "failed");
  const reader = new WorkspaceReader(store, repo);
  return {
    root,
    repo,
    plan,
    save,
    reader,
    issue: () => reader.read("run_original")!.issues.find((i) => i.checkId === "test")!,
  };
}

describe("project issue verification", () => {
  it("aggregates failures and derives verified status from a sealed retry without changing original evidence", () => {
    const f = fixture(),
      before = readFileSync(join(f.root, "run_original", "run.json"));
    expect(f.issue()).toMatchObject({ category: "assertion", status: "open", summary: "Error: src/sample.ts:12:3" });
    f.save("run_retry", "completed", "run_original");
    expect(f.issue()).toMatchObject({ status: "verified", verification: { runId: "run_retry" } });
    expect(readFileSync(join(f.root, "run_original", "run.json"))).toEqual(before);
    expect(f.reader.read("run_original")!.status).toBe("failed");
  });
  it("ignores unrelated passes and retries for another check", () => {
    const f = fixture();
    f.save("run_unrelated", "completed");
    f.save("run_build", "completed", "run_original", { plan: { ...f.plan, checks: [f.plan.checks[0]!] } });
    expect(f.issue().status).toBe("open");
  });
  it.each(["wrongHash", "changedPlan", "missingBuild", "missingTest", "partial", "running"])(
    "does not verify %s evidence",
    (mode) => {
      const f = fixture();
      const changed = projectChecksConfigSchema.parse({
        ...f.plan,
        checks: f.plan.checks.map((c) => ({ ...c, command: "different-command" })),
      });
      f.save("run_retry", mode === "running" ? "running" : "completed", "run_original", {
        wrongHash: mode === "wrongHash",
        plan: mode === "changedPlan" ? changed : f.plan,
        missingBuild: mode === "missingBuild",
        missingTest: mode === "missingTest",
        partial: ["partial", "running"].includes(mode),
      });
      expect(f.issue().status).not.toBe("verified");
      if (mode === "running") expect(f.issue().status).toBe("waiting");
    },
  );
  it("follows retry chains and shows the latest failure instead of an older pass", () => {
    const f = fixture();
    f.save("run_retry", "completed", "run_original");
    f.save("run_retry_again", "failed", "run_retry");
    expect(f.issue()).toMatchObject({ status: "failed", verification: { runId: "run_retry_again" } });
  });
  it("does not fall back to an older pass when the latest retry artifact is corrupted", () => {
    const f = fixture();
    f.save("run_good", "completed", "run_original");
    f.save("run_broken", "completed", "run_original");
    writeFileSync(join(f.root, "run_broken", "check-plan.json"), "{");
    expect(f.issue()).toMatchObject({ status: "unverified", verification: { runId: "run_broken" } });
  });
  it("discovers a half-written retry by its manifest without trusting its missing result", () => {
    const f = fixture();
    f.save("run_good", "completed", "run_original");
    f.save("run_half", "completed", "run_original");
    writeFileSync(join(f.root, "run_half", "run.json"), "{");
    expect(f.issue()).toMatchObject({ status: "unverified", verification: { runId: "run_half" } });
  });
});

describe("Agent case replay verification", () => {
  it("keeps the original failure and verifies only a sealed replay of the same case and assertions", () => {
    const root = mkdtempSync(join(tmpdir(), "canary-agent-issues-"));
    roots.push(root);
    const repo = new FileArtifactRepository(root);
    const sourceCase = { id: "calculate", input: "2+3", assertions: [{ type: "state.equals", value: 5 }] };
    const result = (runId: string, passed: boolean): EvalResult => ({
      runId,
      executionId: `${runId}-execution`,
      caseId: "calculate",
      passed,
      assertions: [{ id: "state.equals", passed, message: passed ? undefined : "expected 5" }],
      coverage: {
        runId,
        sourceHash: "fixture",
        status: "unavailable",
        lines: { covered: 0, total: 0, pct: 0 },
        statements: { covered: 0, total: 0, pct: 0 },
        functions: { covered: 0, total: 0, pct: 0 },
        branches: { covered: 0, total: 0, pct: 0 },
        featureChains: [],
      },
      sourceCase,
    });
    const source: RunSnapshot = {
      runId: "run_agent_failed",
      status: "failed",
      startedAt: "2026-09-25T00:00:00.000Z",
      totalCases: 1,
      completedCases: 1,
      passedCases: 0,
      results: [result("run_agent_failed", false)],
      events: [],
    };
    beginArtifacts(join(root, source.runId));
    writePrivateJson(join(root, source.runId, "run.json"), source);
    sealArtifacts(join(root, source.runId));
    const replay: RunSnapshot = {
      ...source,
      runId: "run_agent_replay",
      status: "completed",
      startedAt: "2026-09-25T00:01:00.000Z",
      passedCases: 1,
      results: [result("run_agent_replay", true)],
      replayOf: source.runId,
      evidence: {
        v: 1,
        lineage: { replayOf: source.runId, parentManifestHash: repo.verify(source.runId).manifestHash! },
      } as RunSnapshot["evidence"],
    };
    beginArtifacts(join(root, replay.runId), replay.evidence!.lineage);
    writePrivateJson(join(root, replay.runId, "run.json"), replay);
    sealArtifacts(join(root, replay.runId));
    const reader = new WorkspaceReader(new RunStore(), repo);
    expect(reader.read(source.runId)!.issues.find((issue) => issue.title === "calculate")).toMatchObject({
      status: "verified",
      verification: { runId: replay.runId },
    });
    const changed: RunSnapshot = {
      ...replay,
      runId: "run_agent_changed",
      startedAt: "2026-09-25T00:02:00.000Z",
      results: [{ ...result("run_agent_changed", true), sourceCase: { ...sourceCase, input: "other task" } }],
    };
    beginArtifacts(join(root, changed.runId), changed.evidence!.lineage);
    writePrivateJson(join(root, changed.runId, "run.json"), changed);
    sealArtifacts(join(root, changed.runId));
    expect(reader.read(source.runId)!.issues.find((issue) => issue.title === "calculate")!.status).toBe("failed");
    writeFileSync(join(root, changed.runId, "run.json"), "{}");
    expect(reader.read(source.runId)!.issues.find((issue) => issue.title === "calculate")!.status).toBe("unverified");
  });
});
