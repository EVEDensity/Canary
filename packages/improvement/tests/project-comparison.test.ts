import { describe, expect, it } from "vitest";
import type { ProjectCheckResult, RunSnapshot } from "@canary/core";
import { projectChecksConfigSchema } from "@canary/core";
import { compareProjectRuns } from "../src/index.js";

const plan = projectChecksConfigSchema.parse({ kind: "canary.project", version: 1, checks: [
  { id: "build", type: "command", command: "node", args: ["build.mjs"] },
  { id: "test", type: "command", command: "node", args: ["test.mjs"], dependsOn: ["build"] },
  { id: "holdout", type: "command", command: "node", args: ["holdout.mjs"], dependsOn: ["build"] },
] });
function check(id: string, passed: boolean): ProjectCheckResult {
  return { id, type: "command", version: 1, required: true, status: passed ? "passed" : "failed", evidence: "verified", exitCode: passed ? 0 : 1, category: passed ? "none" : "assertion", retryable: false, durationMs: 10, cwd: ".", envAllowlist: [], command: "node" };
}
function run(id: string, passed: [boolean, boolean, boolean]): RunSnapshot {
  return { runId: id, status: passed.every(Boolean) ? "completed" : "failed", startedAt: "2026-09-24T00:00:00.000Z", totalCases: 3, completedCases: 3, passedCases: passed.filter(Boolean).length, results: [], events: [], checks: [check("build", passed[0]), check("test", passed[1]), check("holdout", passed[2])] };
}
function compare(baseline = run("run_base", [true, false, true]), candidate = run("run_candidate", [true, true, true]), candidatePlan = plan) {
  return compareProjectRuns({ baseline, candidate, baselinePlan: plan, candidatePlan, baselineManifestHash: "a".repeat(64), candidateManifestHash: "b".repeat(64), regressionCheckIds: ["test"], holdoutCheckIds: ["holdout"] });
}
describe("R8 sealed project run comparison", () => {
  it("records quantified improvement without inventing unavailable token or retry data", () => {
    const result = compare();
    expect(result).toMatchObject({ verdict: "improve", observedImprovement: true, admissible: false, attribution: { status: "unverified" }, improvements: ["test"], regressions: [], metrics: { passRate: { before: 2 / 3, after: 1 }, tokens: { status: "unavailable" }, retries: { status: "unavailable" } } });
    expect(result.reportHash).toMatch(/^[a-f0-9]{64}$/);
    expect(compare().reportHash).toBe(result.reportHash);
  });
  it("fails closed on holdout regression, changed plan, missing evidence and hard gate", () => {
    expect(compare(undefined, run("run_candidate", [true, true, false])).reasons).toContain("holdout_failed");
    expect(compare(undefined, undefined, projectChecksConfigSchema.parse({ ...plan, checks: plan.checks.map((item) => item.id === "test" ? { ...item, args: ["different.mjs"] } : item) })).verdict).toBe("incomparable");
    const missing = run("run_candidate", [true, true, true]); missing.checks = missing.checks!.slice(0, 2);
    expect(compare(undefined, missing).reasons).toContain("check_result_incomplete");
    const gated = run("run_candidate", [true, true, true]); gated.gate = { passed: false, reason: "hard_gate_failed", failures: [], hardGate: { passed: false, policyViolations: 1, unexpectedLoops: 0, stateFailures: 0, unavailableCoreFeatures: [] } };
    expect(compare(undefined, gated).reasons).toContain("hard_gate_failed");
  });
});
