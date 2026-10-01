import { describe, expect, it } from "vitest";
import type { ProjectCheckResult, RunSnapshot } from "@canary/core";
import { buildRunDiagnostics, createDiagnosticBundle, verifyDiagnosticBundle } from "../src/diagnostics.js";

const check = (id: string, overrides: Partial<ProjectCheckResult> = {}): ProjectCheckResult => ({ id, type: "command", version: 1, required: true, status: "failed", evidence: "verified", exitCode: 1, category: "assertion", retryable: false, durationMs: 1, cwd: "/project", envAllowlist: ["API_KEY"], command: "node", args: ["test.js"], ...overrides });
const fixture = (): RunSnapshot => ({ runId: "run_1", status: "failed", startedAt: "2026-10-01T00:00:00Z", totalCases: 3, completedCases: 3, passedCases: 0, results: [], events: [], checks: [check("test", { stderr: "FAIL adds numbers\nAssertionError: wrong result\n    at test (/project/src/test.ts:12:3)", outputTruncated: true }), check("similar", { stderr: "AssertionError: wrong result" }), check("dependent", { status: "blocked", category: "dependency", dependsOn: ["test"] })] });

describe("unified failure diagnostics", () => {
  it("retains errors, test names and stack positions without merging similar failures", () => {
    const run = fixture(), original = JSON.stringify(run);
    const report = buildRunDiagnostics(run, "/project");
    expect(report.failures).toHaveLength(3);
    expect(report.failures[0]).toMatchObject({ testNames: ["adds numbers"], locations: [{ path: "src/test.ts", line: 12, column: 3, mapping: "path-line" }], originalError: { truncated: true }, rootCause: { status: "unknown" } });
    expect(report.failures[1]).toMatchObject({ sourceMapping: "missing", relatedFailures: [], rootCause: { status: "unknown" } });
    expect(report.failures[2]).toMatchObject({ relatedFailures: [{ id: "run_1:check:test", evidence: "declared-dependency" }], rootCause: { status: "hypothesis" } });
    expect(JSON.stringify(run)).toBe(original);
  });
  it("links case assertions and execution identity and rejects external stack positions", () => {
    const run = fixture();
    run.results.push({ runId: run.runId, caseId: "case-1", executionId: "exec-1", passed: false, assertions: [{ id: "equals", passed: false, message: 'File "src/test.py", line 9', details: { expected: 2, actual: 3 } }], coverage: {} as never });
    run.events.push({ type: "execution.failed", executionId: "exec-1", error: "Error: failed\n    at task (/project/src/task.ts:5:2)" });
    run.events.push({ type: "execution.failed", executionId: "unrelated", error: "Error: unrelated" });
    run.checks![0]!.stderr = "at x (/outside/file.ts:3:1)\nat x (../../outside.ts:2:1)";
    const report = buildRunDiagnostics(run, "/project");
    expect(report.failures[0]!.locations).toEqual([]);
    expect(report.failures[3]!.originalError.stderr).not.toContain("unrelated");
    expect(report.failures[3]).toMatchObject({ caseId: "case-1", executionId: "exec-1", assertions: [{ id: "equals", details: { expected: 2, actual: 3 } }], locations: [{ path: "src/task.ts", line: 5, column: 2 }, { path: "src/test.py", line: 9 }] });
  });
  it("redacts credentials everywhere before hashing and verifies a JSON roundtrip", () => {
    const run = fixture();
    run.checks![0]!.args = ["--token=ghp_12345678901234567890", "--password", "opaque-value-123"];
    run.checks![0]!.stderr += "\npassword=superprivate\nhttps://user:pass@example.com";
    const bundle = createDiagnosticBundle(run, "/project");
    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain("superprivate");
    expect(serialized).not.toContain("opaque-value-123");
    expect(serialized).not.toContain("ghp_12345678901234567890");
    expect(serialized).not.toContain("user:pass");
    expect(verifyDiagnosticBundle(JSON.parse(serialized))).toBe(true);
    bundle.files["NEXT-STEPS.txt"] += "tampered";
    expect(verifyDiagnosticBundle(bundle)).toBe(false);
  });
  it("rejects altered diagnostics, duplicate entries, extra files and malformed bundles", () => {
    for (const mutate of [
      (b: ReturnType<typeof createDiagnosticBundle>) => { b.files["diagnostics.json"].runId = "other"; },
      (b: ReturnType<typeof createDiagnosticBundle>) => { b.manifest[1] = b.manifest[0]!; },
      (b: ReturnType<typeof createDiagnosticBundle>) => { Object.assign(b.files, { "extra.txt": "extra" }); },
    ]) {
      const bundle = createDiagnosticBundle(fixture(), "/project"); mutate(bundle);
      expect(verifyDiagnosticBundle(bundle)).toBe(false);
    }
    expect(verifyDiagnosticBundle(null)).toBe(false);
    expect(verifyDiagnosticBundle({})).toBe(false);
  });
});
