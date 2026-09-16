import type {
  AssertionSpec,
  CoverageGateResult,
  CoverageSummary,
  CoverageThresholds,
  EvalResult,
  TestCase,
  Trajectory,
  TrajectoryEvent,
} from "@canary/core";
import { scoreWithTimeout } from "./judge.js";
import type { EvaluationContext, Evaluator } from "./evaluator-types.js";
import { defaultEvaluatorRegistry } from "./registry.js";

export type { EvaluationContext, Evaluator } from "./evaluator-types.js";
export {
  DeterministicJudgeProvider,
  HttpJudgeProvider,
  createJudgeProvider,
  redactJudgePayload,
  scoreWithTimeout,
  type JudgePolicy,
  type JudgeProvider,
  type JudgeRequest,
  type JudgeScore,
  type JudgeVerdict,
} from "./judge.js";
export { EvaluatorRegistry, defaultEvaluatorRegistry, type EvaluatorDescriptor } from "./registry.js";
export { decideAdmission, coverageQualityMetric, type AdmissionDecision, type AdmissionInput, type AdmissionVerdict, type ComparisonVerdict } from "./admission.js";

type Outcome = { id: string; passed: boolean; message?: string; details?: unknown };
type AnyAssertion = AssertionSpec & Record<string, unknown>;
const events = (trajectory?: Trajectory) => trajectory?.events ?? [];
const count = (trajectory: Trajectory | undefined, type: string) => events(trajectory).filter((event) => event.type === type).length;
const numberValue = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const eventCount = (trajectory: Trajectory | undefined, types: string[]) => events(trajectory).filter((event) => types.includes(event.type)).length;
function schemaResult(schema: AnyAssertion["schema"], value: unknown): { passed: boolean; details?: unknown } {
  if (!schema || typeof schema !== "object") return { passed: false, details: "Schema must expose safeParse or parse" };
  const candidate = schema as { safeParse?: (value: unknown) => { success: boolean; error?: unknown }; parse?: (value: unknown) => unknown };
  try {
    if (typeof candidate.safeParse === "function") { const result = candidate.safeParse(value); return { passed: result.success, details: result.success ? undefined : result.error }; }
    if (typeof candidate.parse === "function") { candidate.parse(value); return { passed: true }; }
    return { passed: false, details: "Schema must expose safeParse or parse" };
  } catch (error) { return { passed: false, details: error instanceof Error ? error.message : String(error) }; }
}
function budgetUsed(context: EvaluationContext): number | undefined {
  if (numberValue(context.budgetUsed) !== undefined) return context.budgetUsed;
  const values = events(context.trajectory).map((event) => numberValue(event.cost) ?? numberValue(event.budgetUsed) ?? numberValue(event.tokensCost)).filter((value): value is number => value !== undefined);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : undefined;
}
function matchesEvent(type: string, expected: string): boolean { return type === expected || type.endsWith(`.${expected}`); }
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function containsRecord(actual: unknown, expected: Record<string, unknown>): boolean {
  if (!isRecord(actual)) return false;
  return Object.entries(expected).every(([key, value]) => JSON.stringify(actual[key]) === JSON.stringify(value));
}
function toolCallEvents(trajectory?: Trajectory): Array<TrajectoryEvent & { name?: unknown; args?: unknown }> {
  return events(trajectory).filter((event) => event.type === "tool.call");
}

export async function evaluateAgent(input: { assertions?: AssertionSpec[]; context?: EvaluationContext; trajectory?: Trajectory; output?: unknown }): Promise<Pick<EvalResult, "passed" | "assertions"> & { diagnostics?: string[] }> {
  const context: EvaluationContext = { ...input.context, trajectory: input.trajectory ?? input.context?.trajectory, output: input.output ?? input.context?.output };
  const trajectory = context.trajectory;
  const testCase = context.testCase ?? { id: "anonymous", input: undefined };
  const outcomes: Outcome[] = [];
  const diagnostics: string[] = [];
  for (const [index, raw] of (input.assertions ?? []).entries()) {
    const assertion = raw as AnyAssertion;
    const id = typeof assertion.id === "string" ? assertion.id : `${assertion.type}#${index + 1}`;
    let passed = false; let message: string | undefined; let details: unknown;
    switch (assertion.type) {
      case "output.exists":
        passed = context.output !== undefined && context.output !== null;
        message = passed ? undefined : "Agent output is missing";
        break;
      case "output.schema": {
        const result = schemaResult(assertion.schema, context.output); passed = result.passed; details = result.details;
        message = passed ? undefined : "Agent output does not match schema"; break;
      }
      case "output.predicate":
        try { passed = Boolean(await (assertion.predicate as (output: unknown, context: { testCase: TestCase; trajectory?: Trajectory }) => boolean | Promise<boolean>)(context.output, { testCase, trajectory })); message = passed ? undefined : (typeof assertion.message === "string" ? assertion.message : "Agent output predicate returned false"); }
        catch (error) { message = "Agent output predicate threw an error"; details = error instanceof Error ? error.message : String(error); }
        break;
      case "trajectory.required_event": {
        const expected = String(assertion.event); const actual = events(trajectory).filter((event) => matchesEvent(event.type, expected)).length; const required = numberValue(assertion.minCount) ?? 1;
        passed = actual >= required; details = { event: expected, actual, required }; message = passed ? undefined : `Required event '${expected}' did not occur enough times`; break;
      }
      case "trajectory.forbidden_event": {
        const expected = String(assertion.event); const actual = events(trajectory).filter((event) => matchesEvent(event.type, expected)).length;
        passed = actual === 0; details = { event: expected, actual }; message = passed ? undefined : `Forbidden event '${expected}' occurred`; break;
      }
      case "trajectory.max_steps": {
        const actual = trajectory?.stepCount ?? eventCount(trajectory, ["step", "agent.step"]); const max = numberValue(assertion.max) ?? 0;
        passed = actual <= max; details = { actual, max }; message = passed ? undefined : `Agent exceeded maximum steps (${actual} > ${max})`; break;
      }
      case "trajectory.max_tool_calls": {
        const actual = context.toolCalls ?? eventCount(trajectory, ["tool.call", "tool.called", "tool.start"]); const max = numberValue(assertion.max) ?? 0;
        passed = actual <= max; details = { actual, max }; message = passed ? undefined : `Agent exceeded maximum tool calls (${actual} > ${max})`; break;
      }
      case "execution.termination": {
        const actual = context.executionStatus ?? trajectory?.termination; passed = actual === assertion.expected; details = { actual, expected: assertion.expected }; message = passed ? undefined : "Agent termination status did not match expectation"; break;
      }
      case "trajectory.error_recovery": {
        const errorName = typeof assertion.errorEvent === "string" ? assertion.errorEvent : "error"; const recoveryName = typeof assertion.recoveryEvent === "string" ? assertion.recoveryEvent : "recovery";
        const errorIndex = events(trajectory).findIndex((event) => matchesEvent(event.type, errorName)); const recoveryIndex = events(trajectory).findIndex((event, eventIndex) => eventIndex > errorIndex && matchesEvent(event.type, recoveryName));
        passed = errorIndex < 0 || recoveryIndex > errorIndex; details = { errorEvent: errorName, recoveryEvent: recoveryName, errorIndex, recoveryIndex }; message = passed ? undefined : "Agent did not recover after an error event"; break;
      }
      case "execution.max_latency": {
        const actual = numberValue(context.latencyMs); const max = numberValue(assertion.maxMs) ?? 0; passed = actual !== undefined && actual <= max; details = { actual, max }; message = passed ? undefined : "Agent exceeded maximum latency or latency was unavailable"; break;
      }
      case "execution.max_budget": {
        const actual = budgetUsed(context); const max = numberValue(assertion.max) ?? 0; passed = actual !== undefined && actual <= max; details = { actual, max }; message = passed ? undefined : "Agent exceeded maximum budget or budget was unavailable"; break;
      }
      case "feature.expected": {
        const featureId = String(assertion.featureId); const status = context.featureStatuses?.[featureId]; const expected = context.expectedFeatures?.includes(featureId) ?? true;
        passed = expected && (status === "covered" || status === "partial"); details = { featureId, status, expected }; message = passed ? undefined : `Expected feature '${featureId}' was not covered`; break;
      }
      case "coverage.atLeast": {
        const featureId = String(assertion.featureId);
        const minPct = numberValue(assertion.minPct) ?? 0;
        const feature = context.coverage?.featureChains.find((item) => item.featureId === featureId);
        const actual = feature?.coverage.pct;
        const unavailable = !feature || feature.status === "unavailable" || context.coverage?.status === "unavailable";
        passed = !unavailable && actual !== undefined && actual >= minPct;
        details = { featureId, actual, required: minPct, status: feature?.status ?? context.coverage?.status ?? "unavailable" };
        message = passed ? undefined : unavailable
          ? `Feature '${featureId}' coverage is unavailable`
          : `Feature '${featureId}' coverage ${actual ?? 0}% < ${minPct}%`;
        break;
      }
      case "judge.score": {
        const required = assertion.required ?? context.judgePolicy?.required ?? true;
        const judge = context.judge;
        if (!judge) {
          details = { status: required ? "unavailable" : "skipped", provider: "none" };
          if (required) message = "Required Judge provider is missing";
          else passed = true;
          break;
        }
        const timeoutMs = numberValue(assertion.timeoutMs) ?? 5_000;
        const minScore = numberValue(assertion.minScore) ?? 0.7;
        const minConfidence = numberValue(assertion.minConfidence) ?? 0.5;
        const scored = await scoreWithTimeout(judge, {
          input: testCase.input,
          output: context.output,
          rubric: typeof assertion.rubric === "string" ? assertion.rubric : undefined,
          timeoutMs,
        }, timeoutMs);
        details = scored;
        if (scored.verdict === "timeout") { message = scored.error ?? "Judge timed out"; break; }
        if (scored.verdict === "error") { message = scored.error ?? "Judge error"; break; }
        if (scored.verdict === "low_confidence" || (scored.confidence !== undefined && scored.confidence < minConfidence)) {
          message = "Judge confidence too low to pass"; break;
        }
        if (scored.verdict !== "pass") { message = scored.rationale ?? "Judge did not pass"; break; }
        if (scored.score === undefined) { message = "Judge pass is missing a numeric score"; break; }
        if (scored.score < minScore) { message = `Judge score ${scored.score} < ${minScore}`; break; }
        passed = true;
        break;
      }
      case "tool.called": {
        const name = String(assertion.name);
        const actual = toolCallEvents(trajectory).filter((event) => String(event.name ?? "") === name).length;
        const required = numberValue(assertion.minCount) ?? 1;
        passed = actual >= required; details = { name, actual, required }; message = passed ? undefined : `Tool '${name}' was not called enough times`; break;
      }
      case "tool.args": {
        const name = String(assertion.name);
        const args = toolCallEvents(trajectory).filter((event) => String(event.name ?? "") === name).map((event) => event.args);
        if (assertion.equals !== undefined) passed = args.some((value) => JSON.stringify(value) === JSON.stringify(assertion.equals));
        else if (isRecord(assertion.contains)) passed = args.some((value) => containsRecord(value, assertion.contains as Record<string, unknown>));
        else passed = args.length > 0;
        details = { name, args }; message = passed ? undefined : `Tool '${name}' arguments did not match`; break;
      }
      case "tool.order": {
        const names = Array.isArray(assertion.names) ? assertion.names.map(String) : [];
        const actual = toolCallEvents(trajectory).map((event) => String(event.name ?? ""));
        let cursor = 0;
        for (const name of actual) {
          if (name === names[cursor]) cursor += 1;
          if (cursor >= names.length) break;
        }
        passed = names.length > 0 && cursor >= names.length; details = { expected: names, actual }; message = passed ? undefined : "Tool call order did not match"; break;
      }
      case "state.equals": {
        const key = assertion.key === undefined ? undefined : String(assertion.key);
        const actual = key === undefined ? context.state : isRecord(context.state) ? context.state[key] : undefined;
        passed = JSON.stringify(actual) === JSON.stringify(assertion.value); details = { key, actual, expected: assertion.value }; message = passed ? undefined : "State value did not equal expectation"; break;
      }
      case "state.has": {
        const key = String(assertion.key);
        passed = isRecord(context.state) && Object.prototype.hasOwnProperty.call(context.state, key); details = { key, state: context.state }; message = passed ? undefined : `State is missing key '${key}'`; break;
      }
      case "state.contains": {
        const expected = isRecord(assertion.value) ? assertion.value : isRecord(assertion.contains) ? assertion.contains : undefined;
        passed = Boolean(expected && containsRecord(context.state, expected)); details = { expected, state: context.state }; message = passed ? undefined : "State did not contain expected keys"; break;
      }
      case "policy.none": {
        const violations = events(trajectory).filter((event) => event.type === "policy.violation" || event.type.endsWith(".policy.violation") || event.type === "policy.violated");
        passed = violations.length === 0; details = { count: violations.length }; message = passed ? undefined : `Policy violations: ${violations.length}`; break;
      }
      default:
        message = `Unsupported assertion type '${String(assertion.type)}'`; diagnostics.push(message);
    }
    outcomes.push({ id, passed, message, details });
  }
  return { passed: outcomes.every((outcome) => outcome.passed), assertions: outcomes, diagnostics };
}
export const deterministicAgentEvaluator: Evaluator = { id: "canary.deterministic-agent", evaluate: evaluateAgent };
export const passEmptyEvaluation = async (): Promise<Pick<EvalResult, "passed" | "assertions">> => ({ passed: true, assertions: [] });

if (!defaultEvaluatorRegistry.get(deterministicAgentEvaluator.id)) {
  defaultEvaluatorRegistry.register(deterministicAgentEvaluator, {
    id: "canary.deterministic-agent",
    kind: "deterministic",
    capabilities: ["output", "trajectory", "tool", "state", "coverage", "judge.score", "policy"],
    cost: "none",
  });
}

function hasGlobalThresholds(thresholds: CoverageThresholds): boolean {
  return thresholds.lines != null || thresholds.branches != null || thresholds.functions != null || thresholds.statements != null;
}

/** Shared CLI/CI gate: required coverage cannot pass when status is unavailable/partial.
 * Feature-chain thresholds compare declared-source hit percentage. `status=partial`
 * means the chain was reached but not every unit was hit; that does not fail the gate
 * unless pct is below the configured threshold.
 */
export const FEATURE_CHAIN_GATE_SEMANTICS = { mode: "source_pct" as const, partialDoesNotFail: true as const };

export function evaluateCoverageGates(coverage: CoverageSummary | undefined, thresholds: CoverageThresholds): CoverageGateResult {
  const featureEntries = Object.entries(thresholds.featureChains ?? {});
  const requireGlobal = hasGlobalThresholds(thresholds);
  if (!requireGlobal && !featureEntries.length) return { passed: true, failures: [], featureChainSemantics: FEATURE_CHAIN_GATE_SEMANTICS };

  const failures: CoverageGateResult["failures"] = [];
  if (requireGlobal) {
    const status = coverage?.status ?? "unavailable";
    if (!coverage || status === "unavailable" || status === "partial" || status === "provisional" || status === "preparing") {
      failures.push({
        code: status === "unavailable" ? "unavailable" : "partial",
        target: "coverage",
        status,
        message: `Coverage is ${status}; configured thresholds cannot pass.`,
      });
    } else {
      for (const key of ["lines", "branches", "functions", "statements"] as const) {
        const required = thresholds[key];
        if (required == null) continue;
        const actual = coverage[key]?.pct ?? 0;
        if (actual < required) {
          failures.push({ code: "below_threshold", target: key, required, actual, message: `${key} ${actual}% < ${required}%` });
        }
      }
    }
  }

  for (const [featureId, required] of featureEntries) {
    const feature = coverage?.featureChains.find((item) => item.featureId === featureId);
    if (!feature || feature.status === "unavailable") {
      failures.push({
        code: "feature_unavailable",
        target: featureId,
        status: feature?.status ?? "unavailable",
        required,
        message: `Feature ${featureId} is unavailable; configured threshold cannot pass.`,
      });
      continue;
    }
    if (feature.status === "failed" || feature.coverage.pct < required) {
      failures.push({
        code: "below_threshold",
        target: featureId,
        required,
        actual: feature.coverage.pct,
        status: feature.status,
        message: `feature ${featureId} ${feature.coverage.pct}% < ${required}%`,
      });
    }
  }

  if (!failures.length) return { passed: true, failures: [], featureChainSemantics: FEATURE_CHAIN_GATE_SEMANTICS };
  return { passed: false, reason: "behavior_passed_coverage_insufficient", failureCategory: "coverage_below_threshold", failures, featureChainSemantics: FEATURE_CHAIN_GATE_SEMANTICS };
}

export function exitCodeForRun(input: { runFailed: boolean; gatePassed: boolean; junitFailures: number }): number {
  return input.runFailed || !input.gatePassed || input.junitFailures > 0 ? 1 : 0;
}

export type FailureKind =
  | "wrong_output"
  | "wrong_tool"
  | "wrong_arguments"
  | "schema_error"
  | "unrecovered_error"
  | "loop"
  | "timeout"
  | "cancelled"
  | "budget_exceeded"
  | "state_mismatch"
  | "coverage_gap"
  | "policy_violation"
  | "runtime_error"
  | "assertion_failed";

export type SuggestionCategory = "prompt" | "routing" | "tool_schema" | "recovery" | "guardrail" | "test_gap";

export interface FailureAttribution {
  kind: FailureKind;
  category: SuggestionCategory;
  rationale: string;
  confidence: number;
  evidence: Array<{ type: "trace" | "assertion" | "coverage" | "state"; ref: string }>;
}

function assertionName(id: string): string {
  return id.split("#")[0] ?? id;
}
function failedAssertions(result: EvalResult): EvalResult["assertions"] {
  return result.assertions.filter((item) => !item.passed && item.id !== "agent.completed");
}
function hasFailedAssertion(result: EvalResult, names: string[]): boolean {
  return failedAssertions(result).some((item) => names.includes(assertionName(item.id)));
}
function trajectoryEvents(result: EvalResult): TrajectoryEvent[] {
  return result.trajectory?.events ?? [];
}
function hasEvent(result: EvalResult, type: string): boolean {
  return trajectoryEvents(result).some((event) => event.type === type || event.type.endsWith(`.${type}`));
}
function expectsEvent(result: EvalResult, type: string): boolean {
  return result.assertions.some((item) => {
    if (assertionName(item.id) !== "trajectory.required_event") return false;
    const details = item.details as { event?: string } | undefined;
    return String(details?.event ?? "") === type;
  });
}
function isPolicyEvent(type: string): boolean {
  return type === "policy.violation" || type === "policy.violated" || type.endsWith(".policy.violation");
}
function categoryForKind(kind: FailureKind): SuggestionCategory {
  if (kind === "wrong_output" || kind === "schema_error") return "prompt";
  if (kind === "wrong_tool") return "routing";
  if (kind === "wrong_arguments") return "tool_schema";
  if (kind === "unrecovered_error" || kind === "runtime_error" || kind === "state_mismatch") return "recovery";
  if (kind === "coverage_gap") return "test_gap";
  return "guardrail";
}

export function attributeFailure(result: EvalResult): FailureAttribution {
  const failed = failedAssertions(result);
  const evidence: FailureAttribution["evidence"] = [
    ...failed.map((item) => ({ type: "assertion" as const, ref: item.id })),
    ...trajectoryEvents(result).slice(0, 8).map((event, index) => ({ type: "trace" as const, ref: `${event.type}#${index + 1}` })),
    ...(result.stateDiff?.changed.length ? [{ type: "state" as const, ref: result.stateDiff.changed.join(",") }] : []),
    ...result.coverage.featureChains.filter((feature) => feature.status !== "covered").slice(0, 8).map((feature) => ({ type: "coverage" as const, ref: feature.featureId })),
    ...(result.coverage.files ?? []).flatMap((file) => (file.uncoveredLocations ?? []).slice(0, 4).map((location) => ({ type: "coverage" as const, ref: `${file.filePath}:${location.start.line}` }))),
  ];
  const rationaleOf = (kind: FailureKind, fallback: string, confidence: number): FailureAttribution => ({
    kind,
    category: categoryForKind(kind),
    rationale: failed[0]?.message ?? result.failureCategory ?? fallback,
    confidence,
    evidence,
  });
  const termination = result.trajectory?.termination;
  if (result.failureCategory === "timeout" || termination === "timeout") return rationaleOf("timeout", "Execution timed out", 0.9);
  if (result.failureCategory === "cancelled" || termination === "cancelled") return rationaleOf("cancelled", "Execution cancelled", 0.9);
  if (result.failureCategory === "budget_exceeded" || termination === "budget_exceeded") return rationaleOf("budget_exceeded", "Execution exceeded budget", 0.9);
  if (trajectoryEvents(result).some((event) => isPolicyEvent(event.type)) && !expectsEvent(result, "policy.violation")) {
    return rationaleOf("policy_violation", "Unexpected policy violation", 0.9);
  }
  if (termination === "loop_detected" || (hasEvent(result, "loop_detected") && !expectsEvent(result, "loop_detected"))) {
    return rationaleOf("loop", "Unexpected loop", 0.85);
  }
  if (result.failureCategory === "runtime_error" || result.assertions.some((item) => item.id === "agent.completed" && !item.passed)) {
    return rationaleOf("runtime_error", "Agent runtime error", 0.8);
  }
  if (hasFailedAssertion(result, ["state.equals", "state.has", "state.contains"]) || result.failureCategory === "state_mismatch") {
    return rationaleOf("state_mismatch", "State assertion failed", 0.8);
  }
  if (hasFailedAssertion(result, ["tool.args"])) return rationaleOf("wrong_arguments", "Tool arguments did not match", 0.8);
  if (hasFailedAssertion(result, ["tool.called", "tool.order"])) return rationaleOf("wrong_tool", "Tool routing did not match", 0.75);
  if (hasFailedAssertion(result, ["trajectory.error_recovery"])) return rationaleOf("unrecovered_error", "Tool error was not recovered", 0.75);
  if (hasFailedAssertion(result, ["output.schema"])) return rationaleOf("schema_error", "Output schema mismatch", 0.7);
  if (hasFailedAssertion(result, ["output.exists", "output.predicate"])) return rationaleOf("wrong_output", "Output did not match expectation", 0.65);
  if (hasFailedAssertion(result, ["feature.expected", "coverage.atLeast"]) || result.coverage.featureChains.some((feature) => feature.status === "uncovered" || feature.status === "unavailable")) {
    return rationaleOf("coverage_gap", "Feature or coverage gap", 0.5);
  }
  return rationaleOf("assertion_failed", "Case failed", 0.4);
}

export interface HardGateInput {
  results: EvalResult[];
  coverage?: CoverageSummary;
  coreFeatures?: string[];
}

export function evaluateHardGates(input: HardGateInput): NonNullable<CoverageGateResult["hardGate"]> & { passed: boolean; failures: CoverageGateResult["failures"]; failureCategory?: CoverageGateResult["failureCategory"] } {
  const failures: CoverageGateResult["failures"] = [];
  let policyViolations = 0;
  let unexpectedLoops = 0;
  let stateFailures = 0;
  for (const result of input.results) {
    const unexpectedPolicy = trajectoryEvents(result).filter((event) => isPolicyEvent(event.type)).length && !expectsEvent(result, "policy.violation");
    if (unexpectedPolicy) {
      const count = trajectoryEvents(result).filter((event) => isPolicyEvent(event.type)).length;
      policyViolations += count;
      failures.push({ code: "policy_violation", target: result.caseId, actual: count, required: 0, message: `Case ${result.caseId} had ${count} unexpected policy violation(s)` });
    }
    const unexpectedLoop = (result.trajectory?.termination === "loop_detected" || hasEvent(result, "loop_detected")) && !expectsEvent(result, "loop_detected");
    if (unexpectedLoop) {
      unexpectedLoops += 1;
      failures.push({ code: "loop", target: result.caseId, actual: 1, required: 0, message: `Case ${result.caseId} had an unexpected loop` });
    }
    const stateFailed = result.assertions.filter((item) => !item.passed && assertionName(item.id).startsWith("state.")).length;
    if (stateFailed) {
      stateFailures += stateFailed;
      failures.push({ code: "state_mismatch", target: result.caseId, actual: stateFailed, message: `Case ${result.caseId} failed ${stateFailed} state assertion(s)` });
    }
  }
  const unavailableCoreFeatures = (input.coreFeatures ?? []).filter((featureId) => {
    const feature = input.coverage?.featureChains.find((item) => item.featureId === featureId);
    return !feature || feature.status === "unavailable";
  });
  for (const featureId of unavailableCoreFeatures) {
    failures.push({ code: "feature_unavailable", target: featureId, status: "unavailable", message: `Core feature ${featureId} is unavailable` });
  }
  const passed = failures.length === 0;
  const failureCategory = !passed ? (failures[0]?.code === "feature_unavailable" ? undefined : failures[0]?.code as CoverageGateResult["failureCategory"]) : undefined;
  return { passed, failures, policyViolations, unexpectedLoops, stateFailures, unavailableCoreFeatures, failureCategory };
}

export function mergeQualityGates(coverageGate: CoverageGateResult, hardGate: ReturnType<typeof evaluateHardGates>): CoverageGateResult {
  const passed = coverageGate.passed && hardGate.passed;
  const failures = [...coverageGate.failures, ...hardGate.failures];
  if (passed) return { ...coverageGate, passed: true, failures: [], hardGate };
  if (!hardGate.passed && coverageGate.passed) {
    return { passed: false, reason: "hard_gate_failed", failureCategory: hardGate.failureCategory, failures, featureChainSemantics: coverageGate.featureChainSemantics, hardGate };
  }
  return { ...coverageGate, passed: false, failures, hardGate };
}
