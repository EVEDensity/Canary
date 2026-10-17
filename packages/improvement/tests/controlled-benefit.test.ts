import { describe, expect, it } from "vitest";
import { controlledBenefitSchema, type AssertionSpec, type EvalResult, type RunSnapshot } from "@canary/core";
import { measureControlledBenefit } from "../src/index.js";

const metric = { covered: 1, total: 2, pct: 50 };
const unavailable = {
  runId: "before",
  sourceHash: "source",
  status: "unavailable",
  lines: metric,
  statements: metric,
  functions: metric,
  branches: metric,
  featureChains: [],
} satisfies EvalResult["coverage"];
const scopes = { regressionCaseIds: ["case-0"], holdoutCaseIds: ["case-4"] };

function run(
  id: "before" | "after",
  statuses = id === "before" ? [false, true, true, true, true] : [true, true, true, true, true],
): RunSnapshot {
  const results = statuses.map((passed, index): EvalResult => ({
    runId: id,
    executionId: `${id}-${index}`,
    caseId: `case-${index}`,
    passed,
    coverage: structuredClone(unavailable),
    assertions: [{ id: "route-contract", passed }],
    sourceCase: {
      id: `case-${index}`,
      input: { request: `item-${index}` },
      dataset: { version: "fixed", contentHash: "same-dataset" },
      assertions: [{ type: "tool.called", id: "route-contract", name: "lookup" }],
    },
    metrics: { latencyMs: id === "before" ? 100 : 80, steps: 1, toolCalls: 1, budgetUsed: id === "before" ? 2 : 1 },
  }));
  return {
    runId: id,
    status: "completed",
    startedAt: id === "before" ? "2026-10-18T00:00:00.000Z" : "2026-10-18T00:01:00.000Z",
    totalCases: results.length,
    completedCases: results.length,
    passedCases: results.filter((item) => item.passed).length,
    results,
    events: [],
  };
}

function setContract(target: RunSnapshot, assertions: AssertionSpec[]): void {
  for (const item of target.results) {
    item.sourceCase!.assertions = structuredClone(assertions);
    item.assertions = assertions.map((assertion, index) => ({
      id: assertion.id ?? `${assertion.type}#${index + 1}`,
      passed: item.passed,
    }));
  }
}

describe("R30 controlled benefit", () => {
  it("measures a frozen tool contract and available telemetry without inventing cost, independence or execution authority", () => {
    const result = measureControlledBenefit(run("before"), run("after"), scopes);
    expect(result).toMatchObject({
      status: "observed-improvement",
      sample: { baseline: 5, candidate: 5, paired: 5, deterministicPaired: 5, minimum: 5 },
      changes: { improved: 1, regressed: 0, unchanged: 4, missing: 0 },
      scopes: {
        regression: { paired: 1, improved: 1 },
        holdout: { paired: 1, unchanged: 1 },
        other: { paired: 3, unchanged: 3 },
      },
      rates: { baselinePassedPct: 80, candidatePassedPct: 100, deltaPercentagePoints: 20 },
      telemetry: {
        latencyMs: { paired: 5, baseline: 500, candidate: 400, delta: -100 },
        budgetUnits: { paired: 5, baseline: 10, candidate: 5, delta: -5 },
        modelTokens: null,
        monetaryCost: null,
      },
      uncertainty: { method: "descriptive-paired-observations", reasons: [], confidenceInterval: null },
      interpretation: "fixed-contract-observations-not-causal-or-population-evidence",
      executionGranted: false,
    });
    expect(controlledBenefitSchema.safeParse({ ...result, executionGranted: true }).success).toBe(false);
    expect(controlledBenefitSchema.safeParse({ ...result, installAutomatically: true }).success).toBe(false);
  });

  it.each(["input", "assertions", "environment", "dataset"])(
    "rejects changed %s despite identical case/dataset labels",
    (field) => {
      const before = run("before"),
        after = run("after");
      const snapshot = after.results[0]!.sourceCase!;
      if (field === "input") snapshot.input = { request: "easier request" };
      if (field === "assertions")
        snapshot.assertions = [{ type: "tool.called", id: "route-contract", name: "anything" }];
      if (field === "environment") snapshot.environment = { state: { bypass: true } };
      if (field === "dataset") snapshot.dataset!.version = "changed";
      const result = measureControlledBenefit(before, after, scopes);
      expect(result.status).toBe("insufficient");
      expect(result.uncertainty.reasons).toContain("case-contract-changed");
      expect(result.rates).toBeNull();
      expect(result.changes.improved).toBe(1);
    },
  );

  it("accepts canonical key ordering but binds nested content hashes", () => {
    const before = run("before"),
      after = run("after");
    for (const item of before.results) item.sourceCase!.input = { alpha: 1, beta: 2, contentHash: "a" };
    for (const item of after.results) item.sourceCase!.input = { contentHash: "a", beta: 2, alpha: 1 };
    expect(measureControlledBenefit(before, after, scopes).status).toBe("observed-improvement");
    after.results[0]!.sourceCase!.input = { alpha: 1, beta: 2, contentHash: "b" };
    expect(measureControlledBenefit(before, after, scopes).uncertainty.reasons).toContain("case-contract-changed");
  });

  it.each<AssertionSpec>([
    { type: "judge.score", minScore: 0.8 },
    { type: "output.exists" },
    { type: "output.predicate" },
    { type: "output.schema", schema: {} },
    { type: "state.equals" },
    { type: "tool.args", name: "lookup" },
    { type: "tool.called", name: "lookup", minCount: 0 },
    { type: "state.contains", value: {} },
  ])("refuses weak, judge-only or unreconstructable contracts %j", (assertion) => {
    const before = run("before"),
      after = run("after");
    const assertions = [assertion];
    setContract(before, assertions);
    setContract(after, assertions);
    const result = measureControlledBenefit(before, after, scopes);
    expect(result.status).toBe("insufficient");
    expect(result.rates).toBeNull();
    expect(result.sample.deterministicPaired).toBe(0);
  });

  it("does not let uncalibrated Judge improvement establish deterministic benefit in mixed contracts", () => {
    const before = run("before"),
      after = run("after");
    const assertions: AssertionSpec[] = [{ type: "state.equals", value: { done: true } }, { type: "judge.score" }];
    setContract(before, assertions);
    setContract(after, assertions);
    const result = measureControlledBenefit(before, after, scopes);
    expect(result.status).toBe("insufficient");
    expect(result.uncertainty.reasons).toContain("uncalibrated-judge");
  });

  it("requires exact recorded assertion IDs and does not accept any same-type prefix", () => {
    const before = run("before"),
      after = run("after");
    after.results[0]!.assertions = [{ id: "tool.called#99", passed: true }];
    const result = measureControlledBenefit(before, after, scopes);
    expect(result.status).toBe("insufficient");
    expect(result.uncertainty.reasons).toContain("missing-assertion-result");
  });

  it("accepts the real runner's single builtin completion assertion while rejecting arbitrary or colliding extras", () => {
    const before = run("before"),
      after = run("after");
    for (const target of [before, after])
      for (const item of target.results) item.assertions.unshift({ id: "agent.completed", passed: true });
    expect(measureControlledBenefit(before, after, scopes).status).toBe("observed-improvement");
    after.results[0]!.assertions.push({ id: "unknown-runtime-override", passed: true });
    expect(measureControlledBenefit(before, after, scopes).uncertainty.reasons).toContain("missing-assertion-result");
    after.results[0]!.assertions.pop();
    after.results[0]!.assertions.push({ id: "agent.completed", passed: true });
    expect(measureControlledBenefit(before, after, scopes).uncertainty.reasons).toContain("missing-assertion-result");
  });

  it("does not call recovery from an interrupted runtime or loosened execution budget a task-contract benefit", () => {
    const before = run("before"),
      after = run("after");
    before.results[0]!.failureCategory = "budget_exceeded";
    before.results[0]!.assertions.unshift({ id: "agent.completed", passed: false });
    const result = measureControlledBenefit(before, after, scopes);
    expect(result.status).toBe("insufficient");
    expect(result.uncertainty.reasons).toContain("interrupted-trial");
  });

  it("exposes holdout regression even when net pass rate is unchanged", () => {
    const result = measureControlledBenefit(run("before"), run("after", [true, true, true, true, false]), scopes);
    expect(result).toMatchObject({
      status: "observed-regression",
      changes: { improved: 1, regressed: 1 },
      rates: { deltaPercentagePoints: 0 },
      scopes: { holdout: { regressed: 1 } },
      uncertainty: { reasons: [] },
    });
  });

  it("separates observed unchanged results from measured improvement", () => {
    expect(
      measureControlledBenefit(run("before"), run("after", [false, true, true, true, true]), scopes),
    ).toMatchObject({ status: "no-observed-improvement", changes: { unchanged: 5, improved: 0, regressed: 0 } });
  });

  it("requires a disjoint, present, previously passing holdout", () => {
    for (const changedScopes of [
      { regressionCaseIds: [], holdoutCaseIds: ["case-4"] },
      { regressionCaseIds: ["case-0"], holdoutCaseIds: [] },
      { regressionCaseIds: ["case-0"], holdoutCaseIds: ["case-0"] },
      { regressionCaseIds: ["case-0", "case-0"], holdoutCaseIds: ["case-4"] },
      { regressionCaseIds: ["case-0"], holdoutCaseIds: ["absent"] },
    ])
      expect(measureControlledBenefit(run("before"), run("after"), changedScopes).status).toBe("insufficient");
    const result = measureControlledBenefit(run("before", [false, true, true, true, false]), run("after"), scopes);
    expect(result.uncertainty.reasons).toContain("holdout-was-not-passing");
  });

  it("keeps missing non-regression and non-holdout trials visible rather than claiming a full improvement", () => {
    const before = run("before"),
      after = run("after");
    after.results.splice(2, 1);
    after.totalCases--;
    after.completedCases--;
    after.passedCases--;
    const result = measureControlledBenefit(before, after, scopes);
    expect(result).toMatchObject({
      status: "insufficient",
      sample: { paired: 4 },
      changes: { missing: 1 },
      scopes: { other: { missing: 1 } },
      rates: null,
    });
    expect(result.uncertainty.reasons).toContain("unpaired-trial");
  });

  it("requires unique executions and exact repetition topology", () => {
    const before = run("before"),
      after = run("after");
    after.results[1]!.executionId = after.results[0]!.executionId;
    expect(measureControlledBenefit(before, after, scopes).uncertainty.reasons).toContain("invalid-trial-identity");
    after.results[1]!.executionId = "after-1";
    after.results[0]!.repetition = 1;
    expect(measureControlledBenefit(before, after, scopes).changes.missing).toBe(2);
    after.results[0]!.repetition = undefined;
    after.results.push(structuredClone(after.results[0]!));
    after.totalCases++;
    after.completedCases++;
    after.passedCases++;
    expect(measureControlledBenefit(before, after, scopes).uncertainty.reasons).toContain("duplicate-trial");
  });

  it("reports small samples without inventing confidence intervals", () => {
    const before = run("before", [false, true]),
      after = run("after", [true, true]);
    const result = measureControlledBenefit(before, after, {
      regressionCaseIds: ["case-0"],
      holdoutCaseIds: ["case-1"],
    });
    expect(result).toMatchObject({
      status: "insufficient",
      sample: { paired: 2 },
      changes: { improved: 1 },
      uncertainty: { reasons: ["too-few-pairs"], confidenceInterval: null },
    });
  });

  it("counts telemetry only on pairs that actually recorded it and leaves missing telemetry unknown", () => {
    const before = run("before"),
      after = run("after");
    for (const item of after.results.slice(1)) delete item.metrics;
    before.results[0]!.metrics!.budgetUsed = Number.NaN;
    const result = measureControlledBenefit(before, after, scopes);
    expect(result.status).toBe("observed-improvement");
    expect(result.telemetry.latencyMs).toEqual({ paired: 1, baseline: 100, candidate: 80, delta: -20 });
    expect(result.telemetry.budgetUnits).toBeNull();
    expect(result.telemetry.modelTokens).toBeNull();
  });

  it.each(["unfinished", "counters", "time", "identity", "contradiction", "runtime", "hard-gate"])(
    "rejects %s evidence inconsistencies",
    (defect) => {
      const before = run("before"),
        after = run("after");
      if (defect === "unfinished") after.status = "running";
      if (defect === "counters") after.completedCases = 1;
      if (defect === "time") after.startedAt = before.startedAt;
      if (defect === "identity") after.results[0]!.runId = "foreign-run";
      if (defect === "contradiction") after.results[0]!.assertions[0]!.passed = false;
      if (defect === "runtime") after.results[0]!.failureCategory = "timeout";
      if (defect === "hard-gate")
        after.gate = { reason: "hard_gate_failed", hardGate: { passed: false } } as RunSnapshot["gate"];
      expect(measureControlledBenefit(before, after, scopes).status).toBe("insufficient");
    },
  );

  it("does not require coverage for an independent tool contract but refuses unavailable coverage-dependent contracts", () => {
    const before = run("before"),
      after = run("after");
    const assertions: AssertionSpec[] = [
      { type: "tool.called", name: "lookup" },
      { type: "coverage.atLeast", featureId: "routing", minPct: 80 },
    ];
    setContract(before, assertions);
    setContract(after, assertions);
    expect(measureControlledBenefit(before, after, scopes).uncertainty.reasons).toContain(
      "coverage-contract-unavailable",
    );
  });

  it("rejects source snapshots containing live code without running it", () => {
    let called = false;
    const before = run("before"),
      after = run("after");
    before.results[0]!.sourceCase!.input = {
      execute: () => {
        called = true;
      },
    };
    const result = measureControlledBenefit(before, after, scopes);
    expect(result.uncertainty.reasons).toContain("unsupported-case-contract");
    expect(called).toBe(false);
  });

  it("rejects live input accessors and sparse arrays before canonicalizing them", () => {
    let called = false;
    const before = run("before"),
      after = run("after");
    before.results[0]!.sourceCase!.input = {
      get hidden() {
        called = true;
        return "value";
      },
    };
    expect(measureControlledBenefit(before, after, scopes).uncertainty.reasons).toContain("unsupported-case-contract");
    expect(called).toBe(false);
    before.results[0]!.sourceCase!.input = Array(100_000);
    expect(measureControlledBenefit(before, after, scopes).uncertainty.reasons).toContain("unsupported-case-contract");
  });

  it("keeps oversized evaluations bounded and produces schema-valid insufficient evidence", () => {
    const before = run(
      "before",
      Array.from({ length: 257 }, () => true),
    );
    const result = measureControlledBenefit(before, run("after"), scopes);
    expect(result).toMatchObject({
      status: "insufficient",
      sample: { baseline: 257, paired: 0 },
      uncertainty: { reasons: ["sample-limit-exceeded"] },
    });
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(4096);
  });
});
