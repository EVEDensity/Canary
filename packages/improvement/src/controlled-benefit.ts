import {
  CONTROLLED_BENEFIT_MAX_CASES,
  CONTROLLED_BENEFIT_MAX_TRIALS,
  CONTROLLED_BENEFIT_MIN_PAIRS,
  controlledBenefitSchema,
  projectMemoryHash,
  type ControlledBenefit,
  type ControlledBenefitReason,
  type AssertionSpec,
  type EvalResult,
  type RunSnapshot,
} from "@canary/core";
import { compareRuns, trialKey } from "./index.js";

export type { ControlledBenefit } from "@canary/core";

export interface ControlledBenefitScopes {
  regressionCaseIds: string[];
  holdoutCaseIds: string[];
}

const deterministicContracts = new Set([
  "output.exists",
  "trajectory.required_event",
  "trajectory.forbidden_event",
  "trajectory.max_steps",
  "trajectory.max_tool_calls",
  "execution.termination",
  "trajectory.error_recovery",
  "execution.max_latency",
  "execution.max_budget",
  "feature.expected",
  "coverage.atLeast",
  "tool.called",
  "tool.args",
  "tool.order",
  "state.equals",
  "state.has",
  "state.contains",
  "policy.none",
]);
const outcomeContracts = new Set(["tool.called", "tool.args", "tool.order", "state.equals", "state.contains"]);
const emptyScope = (): ControlledBenefit["scopes"]["regression"] => ({
  paired: 0,
  improved: 0,
  regressed: 0,
  unchanged: 0,
  missing: 0,
});
const validId = (value: string): boolean =>
  typeof value === "string" && value.length > 0 && value.length <= 180 && !/[\x00-\x1f\x7f]/.test(value);
const finiteNonnegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const objectWithKeys = (value: unknown): boolean =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.keys(value as object).length > 0;

function meaningfulOutcome(spec: AssertionSpec): boolean {
  const item = spec as Record<string, unknown>;
  if (spec.type === "state.equals") return Object.hasOwn(item, "value") && item.value !== undefined;
  if (spec.type === "state.contains") return objectWithKeys(item.value) || objectWithKeys(item.contains);
  if (spec.type === "tool.called")
    return (
      typeof item.name === "string" &&
      item.name.length > 0 &&
      (item.minCount === undefined || (Number.isSafeInteger(item.minCount) && Number(item.minCount) >= 1))
    );
  if (spec.type === "tool.args")
    return (
      typeof item.name === "string" &&
      item.name.length > 0 &&
      ((Object.hasOwn(item, "equals") && item.equals !== undefined) || objectWithKeys(item.contains))
    );
  if (spec.type === "tool.order")
    return (
      Array.isArray(item.names) &&
      item.names.length > 0 &&
      item.names.every((name) => typeof name === "string" && name.length > 0)
    );
  return false;
}

/** A live function, cyclic value, omitted operand or oversized contract cannot establish frozen identity. */
function contractHash(value: unknown): string | undefined {
  const seen = new Set<object>();
  let nodes = 0;
  function json(item: unknown, depth = 0): boolean {
    if (++nodes > 32_768 || depth > 32) return false;
    if (item === null || typeof item === "string" || typeof item === "boolean") return true;
    if (typeof item === "number") return Number.isFinite(item);
    if (item === undefined) return true; // Source snapshots have optional object fields before persistence.
    if (!item || typeof item !== "object" || seen.has(item)) return false;
    if (
      !Array.isArray(item) &&
      Object.getPrototypeOf(item) !== Object.prototype &&
      Object.getPrototypeOf(item) !== null
    )
      return false;
    if (Array.isArray(item) && item.length > 32_768) return false;
    seen.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    if (
      Object.getOwnPropertySymbols(item).length ||
      Object.values(descriptors).some((descriptor) => descriptor.get || descriptor.set)
    )
      return false;
    const valid = Array.isArray(item)
      ? Array.from({ length: item.length }, (_, index) => descriptors[String(index)]).every(
          (descriptor) => descriptor && descriptor.value !== undefined && json(descriptor.value, depth + 1),
        ) && Object.keys(descriptors).every((key) => key === "length" || /^(?:0|[1-9][0-9]*)$/.test(key))
      : Object.values(descriptors).every((descriptor) => json(descriptor.value, depth + 1));
    seen.delete(item);
    return valid;
  }
  if (!json(value)) return undefined;
  try {
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > 262_144) return undefined;
    // Wrap so a sourceCase field named contentHash is also bound by the shared canonical hasher.
    return projectMemoryHash({ sourceCase: value });
  } catch {
    return undefined;
  }
}

function validCounters(run: RunSnapshot): boolean {
  return (
    Number.isSafeInteger(run.totalCases) &&
    run.totalCases === run.results.length &&
    run.completedCases === run.results.length &&
    run.passedCases === run.results.filter((item) => item.passed).length
  );
}

function validAssertions(result: EvalResult): boolean {
  const specs = result.sourceCase?.assertions ?? [];
  const expected = specs.map((spec, index) => spec.id ?? `${spec.type}#${index + 1}`);
  // The runner prepends this runtime assertion independently of the frozen user contract.
  // Never accept custom extras or collisions between a user assertion and the reserved runtime ID.
  const runtime = result.assertions.filter((assertion) => assertion.id === "agent.completed");
  if (runtime.length > 1 || (runtime.length > 0 && expected.includes("agent.completed"))) return false;
  const actual = result.assertions.filter((assertion) => assertion.id !== "agent.completed");
  return (
    expected.length > 0 &&
    new Set(expected).size === expected.length &&
    actual.length === expected.length &&
    new Set(actual.map((assertion) => assertion.id)).size === expected.length &&
    expected.every((id) => actual.some((assertion) => assertion.id === id))
  );
}

function interrupted(result: EvalResult): boolean {
  return (
    ["cancelled", "timeout", "runtime_error", "budget_exceeded", "loop"].includes(result.failureCategory ?? "") ||
    ["cancelled", "timeout", "error", "budget_exceeded", "loop_detected"].includes(
      result.trajectory?.termination ?? "",
    ) ||
    result.assertions.some((assertion) => assertion.id === "agent.completed" && !assertion.passed)
  );
}

function telemetry(
  pairs: Array<[EvalResult, EvalResult]>,
  field: "latencyMs" | "steps" | "toolCalls" | "budgetUsed",
): ControlledBenefit["telemetry"]["latencyMs"] {
  let paired = 0,
    baseline = 0,
    candidate = 0;
  for (const [before, after] of pairs) {
    const a = before.metrics?.[field],
      b = after.metrics?.[field];
    if (!finiteNonnegative(a) || !finiteNonnegative(b)) continue;
    paired++;
    baseline += a;
    candidate += b;
  }
  return paired && Number.isFinite(baseline) && Number.isFinite(candidate)
    ? { paired, baseline, candidate, delta: candidate - baseline }
    : null;
}

/**
 * Measure fixed-contract observations without running project code or scoring with a model.
 * Tool assertions measure the declared tool contract, not overall task correctness. Repetitions
 * and cases may be dependent, so rates are descriptive and no statistical confidence is invented.
 * Integrity and selected-failure authorization remain the caller's responsibility.
 */
export function measureControlledBenefit(
  baseline: RunSnapshot,
  candidate: RunSnapshot,
  scope: ControlledBenefitScopes,
): ControlledBenefit {
  const reasons = new Set<ControlledBenefitReason>();
  const add = (reason: ControlledBenefitReason): void => {
    reasons.add(reason);
  };
  const output: ControlledBenefit = {
    v: 1,
    kind: "canary.controlled-benefit",
    baselineRunId: validId(baseline.runId) ? baseline.runId : "invalid-run-id",
    candidateRunId: validId(candidate.runId) ? candidate.runId : "invalid-run-id",
    status: "insufficient",
    sample: {
      baseline: baseline.results.length,
      candidate: candidate.results.length,
      paired: 0,
      deterministicPaired: 0,
      minimum: CONTROLLED_BENEFIT_MIN_PAIRS,
    },
    changes: { improved: 0, regressed: 0, unchanged: 0, missing: 0 },
    scopes: { regression: emptyScope(), holdout: emptyScope(), other: emptyScope() },
    rates: null,
    telemetry: {
      latencyMs: null,
      steps: null,
      toolCalls: null,
      budgetUnits: null,
      modelTokens: null,
      monetaryCost: null,
    },
    comparison: { verdict: "incomparable", comparable: false },
    uncertainty: { method: "descriptive-paired-observations", reasons: [], confidenceInterval: null },
    interpretation: "fixed-contract-observations-not-causal-or-population-evidence",
    executionGranted: false,
  };
  const finish = (): ControlledBenefit => {
    output.uncertainty.reasons = [...reasons];
    return controlledBenefitSchema.parse(output);
  };
  if (
    baseline.results.length > CONTROLLED_BENEFIT_MAX_TRIALS ||
    candidate.results.length > CONTROLLED_BENEFIT_MAX_TRIALS ||
    new Set([...baseline.results, ...candidate.results].map((item) => item.caseId)).size > CONTROLLED_BENEFIT_MAX_CASES
  ) {
    add("sample-limit-exceeded");
    return finish();
  }
  if (
    !validId(baseline.runId) ||
    !validId(candidate.runId) ||
    baseline.runId === candidate.runId ||
    !Number.isFinite(Date.parse(baseline.startedAt)) ||
    !Number.isFinite(Date.parse(candidate.startedAt)) ||
    Date.parse(baseline.startedAt) >= Date.parse(candidate.startedAt)
  )
    add("invalid-run-identity");
  if (!["completed", "failed"].includes(baseline.status) || !["completed", "failed"].includes(candidate.status))
    add("unfinished-run");
  if (!validCounters(baseline) || !validCounters(candidate)) add("invalid-run-counters");
  if (candidate.gate?.hardGate?.passed === false || candidate.gate?.reason === "hard_gate_failed")
    add("hard-gate-failed");

  const regression = new Set(scope.regressionCaseIds),
    holdout = new Set(scope.holdoutCaseIds);
  if (!regression.size) add("empty-regression-scope");
  if (!holdout.size) add("empty-holdout-scope");
  if (
    scope.regressionCaseIds.length > CONTROLLED_BENEFIT_MAX_CASES ||
    scope.holdoutCaseIds.length > CONTROLLED_BENEFIT_MAX_CASES ||
    regression.size !== scope.regressionCaseIds.length ||
    holdout.size !== scope.holdoutCaseIds.length ||
    [...regression, ...holdout].some((id) => !validId(id))
  )
    add("invalid-scope");
  if ([...regression].some((id) => holdout.has(id))) add("overlapping-scopes");
  for (const id of [...regression, ...holdout])
    if (!baseline.results.some((item) => item.caseId === id) || !candidate.results.some((item) => item.caseId === id))
      add("missing-scope-case");
  if (baseline.results.some((item) => holdout.has(item.caseId) && !item.passed)) add("holdout-was-not-passing");

  const before = new Map(baseline.results.map((item) => [trialKey(item), item]));
  const after = new Map(candidate.results.map((item) => [trialKey(item), item]));
  if (before.size !== baseline.results.length || after.size !== candidate.results.length) add("duplicate-trial");
  if (
    new Set(baseline.results.map((item) => item.executionId)).size !== baseline.results.length ||
    new Set(candidate.results.map((item) => item.executionId)).size !== candidate.results.length
  )
    add("invalid-trial-identity");
  const pairs: Array<[EvalResult, EvalResult]> = [];
  const all = new Set([...before.keys(), ...after.keys()]);
  for (const id of all) {
    const a = before.get(id),
      b = after.get(id),
      example = a ?? b!;
    const bucket = regression.has(example.caseId)
      ? output.scopes.regression
      : holdout.has(example.caseId)
        ? output.scopes.holdout
        : output.scopes.other;
    if (!a || !b) {
      output.changes.missing++;
      bucket.missing++;
      add("unpaired-trial");
      continue;
    }
    pairs.push([a, b]);
    bucket.paired++;
    const outcome = a.passed === b.passed ? "unchanged" : a.passed ? "regressed" : "improved";
    output.changes[outcome]++;
    bucket[outcome]++;
    for (const [item, run] of [
      [a, baseline],
      [b, candidate],
    ] as const) {
      if (
        !validId(item.caseId) ||
        !validId(item.executionId) ||
        item.runId !== run.runId ||
        (item.repetition !== undefined && (!Number.isSafeInteger(item.repetition) || item.repetition < 0))
      )
        add("invalid-trial-identity");
      if (interrupted(item)) add("interrupted-trial");
      if (item.passed !== (item.assertions.length > 0 && item.assertions.every((assertion) => assertion.passed)))
        add("contradictory-result");
    }
    if (
      !a.sourceCase ||
      !b.sourceCase ||
      a.sourceCase.id !== a.caseId ||
      b.sourceCase.id !== b.caseId ||
      a.sourceCase.input === undefined ||
      b.sourceCase.input === undefined
    ) {
      add("missing-case-snapshot");
      continue;
    }
    const aHash = contractHash(a.sourceCase),
      bHash = contractHash(b.sourceCase);
    if (!aHash || !bHash) {
      add("unsupported-case-contract");
      continue;
    }
    if (aHash !== bHash) {
      add("case-contract-changed");
      continue;
    }
    const specs = a.sourceCase.assertions ?? [];
    if (specs.some((spec) => spec.type === "judge.score")) add("uncalibrated-judge");
    if (specs.some((spec) => spec.type !== "judge.score" && !deterministicContracts.has(spec.type)))
      add("unsupported-case-contract");
    if (!validAssertions(a) || !validAssertions(b)) {
      add("missing-assertion-result");
      continue;
    }
    if (!specs.some((spec) => outcomeContracts.has(spec.type) && meaningfulOutcome(spec))) {
      add("missing-deterministic-contract");
      continue;
    }
    if (
      specs.some((spec) => spec.type === "coverage.atLeast" || spec.type === "feature.expected") &&
      (!baseline.coverage ||
        !candidate.coverage ||
        baseline.coverage.status !== "final" ||
        candidate.coverage.status !== "final" ||
        baseline.coverage.lines.total !== candidate.coverage.lines.total ||
        baseline.coverage.branches.total !== candidate.coverage.branches.total)
    )
      add("coverage-contract-unavailable");
    if (specs.every((spec) => deterministicContracts.has(spec.type))) output.sample.deterministicPaired++;
  }
  output.sample.paired = pairs.length;
  if (pairs.length < CONTROLLED_BENEFIT_MIN_PAIRS) add("too-few-pairs");
  const comparison = compareRuns(baseline, candidate, [...holdout]);
  output.comparison = { verdict: comparison.verdict, comparable: comparison.comparable };
  output.telemetry = {
    latencyMs: telemetry(pairs, "latencyMs"),
    steps: telemetry(pairs, "steps"),
    toolCalls: telemetry(pairs, "toolCalls"),
    budgetUnits: telemetry(pairs, "budgetUsed"),
    modelTokens: null,
    monetaryCost: null,
  };
  if (pairs.length && output.sample.deterministicPaired === pairs.length && !reasons.size) {
    const basePassed = pairs.filter(([item]) => item.passed).length,
      candPassed = pairs.filter(([, item]) => item.passed).length;
    output.rates = {
      baselinePassedPct: (100 * basePassed) / pairs.length,
      candidatePassedPct: (100 * candPassed) / pairs.length,
      deltaPercentagePoints: (100 * (candPassed - basePassed)) / pairs.length,
    };
    output.status = output.changes.regressed
      ? "observed-regression"
      : output.scopes.regression.improved > 0
        ? "observed-improvement"
        : "no-observed-improvement";
  }
  return finish();
}
