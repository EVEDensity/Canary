import { describe, expect, it } from "vitest";
import { evaluateAgent, evaluateCoverageGates, exitCodeForRun } from "../src/index.js";
import type { CoverageSummary, Trajectory } from "@canary/core";

const trajectory = (events: Trajectory["events"], termination: Trajectory["termination"] = "completed"): Trajectory => ({
  id: "t1", runId: "r1", caseId: "c1", events, stepCount: 3, termination,
});

const event = (type: string, extra: Record<string, unknown> = {}) => ({ type, timestamp: new Date().toISOString(), ...extra });

describe("deterministic Agent evaluator", () => {
  it("evaluates output existence, schema and predicate", async () => {
    const schema = { safeParse: (value: unknown) => ({ success: typeof value === "object" && value !== null }) };
    const result = await evaluateAgent({ output: { ok: true }, assertions: [
      { type: "output.exists" }, { type: "output.schema", schema },
      { type: "output.predicate", predicate: (value) => (value as { ok: boolean }).ok },
    ] });
    expect(result.passed).toBe(true);
    expect(result.assertions).toHaveLength(3);
  });

  it("checks trajectory events, limits, termination and recovery", async () => {
    const result = await evaluateAgent({ trajectory: trajectory([
      event("error"), event("recovery"), event("tool.call"), event("required"),
    ]), assertions: [
      { type: "trajectory.required_event", event: "required" },
      { type: "trajectory.forbidden_event", event: "forbidden" },
      { type: "trajectory.max_steps", max: 3 },
      { type: "trajectory.max_tool_calls", max: 1 },
      { type: "execution.termination", expected: "completed" },
      { type: "trajectory.error_recovery" },
    ] });
    expect(result.passed).toBe(true);
  });

  it("fails latency, budget and feature assertions deterministically", async () => {
    const result = await evaluateAgent({
      context: { latencyMs: 101, budgetUsed: 12, expectedFeatures: ["search"], featureStatuses: { search: "uncovered" } },
      assertions: [
        { type: "execution.max_latency", maxMs: 100 },
        { type: "execution.max_budget", max: 10 },
        { type: "feature.expected", featureId: "search" },
      ],
    });
    expect(result.passed).toBe(false);
    expect(result.assertions.every((item) => item.passed)).toBe(false);
  });

  it("supports parse-only schemas and reports unsupported assertions", async () => {
    const result = await evaluateAgent({ output: "ok", assertions: [
      { type: "output.schema", schema: { parse: (value: unknown) => { if (value !== "ok") throw new Error("bad"); return value; } } },
      { type: "unknown.assertion" },
    ] });
    expect(result.passed).toBe(false);
    expect(result.diagnostics?.[0]).toContain("Unsupported assertion");
  });
});

const coverage = (status: CoverageSummary["status"], pct = 90): CoverageSummary => ({
  runId: "r", sourceHash: "h", status,
  lines: { covered: pct, total: 100, pct }, statements: { covered: pct, total: 100, pct },
  functions: { covered: pct, total: 100, pct }, branches: { covered: pct, total: 100, pct },
  featureChains: [{ featureId: "planning", name: "Planning", status: "partial", caseIds: [], expectedCaseIds: [], failedCaseIds: [], filePaths: [], coverage: { covered: 8, total: 10, pct: 80 }, uncoveredLocations: [] }],
});

describe("coverage / feature gates", () => {
  it("passes when no thresholds are configured, even if coverage is unavailable", () => {
    expect(evaluateCoverageGates(undefined, {}).passed).toBe(true);
  });

  it("fails required coverage when status is unavailable or partial", () => {
    expect(evaluateCoverageGates(undefined, { lines: 80 }).failures[0]?.code).toBe("unavailable");
    expect(evaluateCoverageGates(coverage("unavailable"), { lines: 80 }).passed).toBe(false);
    expect(evaluateCoverageGates(coverage("partial", 99), { lines: 80 }).passed).toBe(false);
    expect(evaluateCoverageGates(coverage("final", 79), { lines: 80 }).failures[0]?.code).toBe("below_threshold");
    expect(evaluateCoverageGates(coverage("final", 80), { lines: 80, branches: 70, functions: 75 }).passed).toBe(true);
  });

  it("fails a required feature that is unavailable, and compares feature pct otherwise", () => {
    const missing = coverage("final", 90);
    missing.featureChains = [];
    expect(evaluateCoverageGates(missing, { featureChains: { planning: 70 } }).failures[0]?.code).toBe("feature_unavailable");
    expect(evaluateCoverageGates(coverage("final", 90), { featureChains: { planning: 70 } }).passed).toBe(true);
    expect(evaluateCoverageGates(coverage("final", 90), { featureChains: { planning: 90 } }).passed).toBe(false);
  });

  it("shares the CI exit rule: failed run, failed gate, or JUnit failures all return 1", () => {
    expect(exitCodeForRun({ runFailed: false, gatePassed: true, junitFailures: 0 })).toBe(0);
    expect(exitCodeForRun({ runFailed: true, gatePassed: true, junitFailures: 0 })).toBe(1);
    expect(exitCodeForRun({ runFailed: false, gatePassed: false, junitFailures: 0 })).toBe(1);
    expect(exitCodeForRun({ runFailed: false, gatePassed: true, junitFailures: 2 })).toBe(1);
  });
});
