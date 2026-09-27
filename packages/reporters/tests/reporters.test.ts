import { describe, expect, it } from "vitest";
import { countJunitFailures, renderJunit, renderMarkdown, renderReport } from "../src/index.js";
import type { EvalResult, ProjectCheckResult } from "@canary/core";

const result = (caseId: string, passed: boolean): EvalResult => ({
  runId: "run_1",
  executionId: "exec_1",
  caseId,
  passed,
  assertions: [{ id: "output.exists", passed, message: passed ? undefined : "missing" }],
  coverage: { runId: "run_1", sourceHash: "h", status: "final", lines: { covered: 1, total: 2, pct: 50 }, statements: { covered: 1, total: 2, pct: 50 }, functions: { covered: 1, total: 1, pct: 100 }, branches: { covered: 0, total: 1, pct: 0 }, featureChains: [] },
  metrics: { latencyMs: 12, steps: 1, toolCalls: 1 },
  failureCategory: passed ? undefined : "assertion_failed",
});

describe("run reporters", () => {
  const run = { runId: "run_1", status: "failed", totalCases: 2, passedCases: 1, results: [result("ok", true), result("bad", false)], coverage: result("ok", true).coverage };

  it("renders markdown with pass/fail counts", () => {
    const markdown = renderMarkdown(run);
    expect(markdown).toContain("run_1");
    expect(markdown).toContain("PASS ok");
    expect(markdown).toContain("FAIL bad");
  });

  it("renders junit failures for CI", () => {
    const xml = renderJunit(run);
    expect(xml).toContain('tests="2"');
    expect(xml).toContain('failures="1"');
    expect(xml).toContain("<failure");
    expect(xml).toContain("bad");
  });

  it("counts JUnit failures and includes a coverage.gate case when the shared gate fails", () => {
    const xml = renderJunit({
      ...run,
      status: "failed",
      gate: { passed: false, reason: "behavior_passed_coverage_insufficient", failureCategory: "coverage_below_threshold", failures: [{ code: "below_threshold", target: "lines", required: 80, actual: 50, message: "lines 50% < 80%" }] },
    });
    expect(countJunitFailures(xml)).toBe(2);
    expect(xml).toContain("coverage.gate");
    expect(xml).toContain("lines 50%");
  });

  it("selects json as the machine-readable format", () => {
    const json = JSON.parse(renderReport(run, "json"));
    expect(json.cases.failed).toBe(1);
    expect(json.results).toHaveLength(2);
  });

  it("renders a console reporter with pass/fail rows", () => {
    const body = renderReport(run, "console");
    expect(body).toContain("canary run_1");
    expect(body).toContain("PASS ok");
    expect(body).toContain("FAIL bad");
  });
  it("reports omitted incremental checks as skipped, never as passing results", () => {
    const check: ProjectCheckResult = { id: "run", version: 1, type: "command", required: true, status: "passed", evidence: "verified", exitCode: 0, category: "none", retryable: false, durationMs: 10, cwd: ".", envAllowlist: [] };
    const project = { ...run, status: "completed", checks: [check], results: [], checkSelection: { requested: "affected" as const, mode: "reduced" as const, planned: 2, selected: 1, omitted: 1, fallbackReasons: [], omittedChecks: [{ id: "omitted<&", reason: "declared-scope-unaffected" }] } };
    const xml = renderJunit(project);
    expect(xml).toContain('tests="2"'); expect(xml).toContain('skipped="1"');
    expect(xml).toContain('name="omitted&lt;&amp;"'); expect(xml).toContain("not executed");
    expect(JSON.parse(renderReport(project, "json")).selection.omitted).toBe(1);
    expect(renderMarkdown(project)).toContain("not passed");
  });
});
