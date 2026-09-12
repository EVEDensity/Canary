import type {
  AssertionSpec,
  CoverageGateResult,
  CoverageSummary,
  CoverageThresholds,
  EvalResult,
  ExecutionTermination,
  TestCase,
  Trajectory,
} from "@canary/core";

export interface EvaluationContext {
  testCase?: TestCase;
  output?: unknown;
  trajectory?: Trajectory;
  executionStatus?: ExecutionTermination;
  latencyMs?: number;
  toolCalls?: number;
  budgetUsed?: number;
  expectedFeatures?: readonly string[];
  featureStatuses?: Readonly<Record<string, string>>;
}
export interface Evaluator {
  id: string;
  evaluate(input: { assertions: AssertionSpec[]; context?: EvaluationContext; trajectory?: Trajectory; output?: unknown }): Promise<Pick<EvalResult, "passed" | "assertions"> & { diagnostics?: string[] }>;
}
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
      default:
        message = `Unsupported assertion type '${String(assertion.type)}'`; diagnostics.push(message);
    }
    outcomes.push({ id, passed, message, details });
  }
  return { passed: outcomes.every((outcome) => outcome.passed), assertions: outcomes, diagnostics };
}
export const deterministicAgentEvaluator: Evaluator = { id: "canary.deterministic-agent", evaluate: evaluateAgent };
export const passEmptyEvaluation = async (): Promise<Pick<EvalResult, "passed" | "assertions">> => ({ passed: true, assertions: [] });

function hasGlobalThresholds(thresholds: CoverageThresholds): boolean {
  return thresholds.lines != null || thresholds.branches != null || thresholds.functions != null || thresholds.statements != null;
}

/** Shared CLI/CI gate: required coverage cannot pass when status is unavailable/partial. */
export function evaluateCoverageGates(coverage: CoverageSummary | undefined, thresholds: CoverageThresholds): CoverageGateResult {
  const featureEntries = Object.entries(thresholds.featureChains ?? {});
  const requireGlobal = hasGlobalThresholds(thresholds);
  if (!requireGlobal && !featureEntries.length) return { passed: true, failures: [] };

  const failures: CoverageGateResult["failures"] = [];
  if (requireGlobal) {
    const status = coverage?.status ?? "unavailable";
    if (!coverage || status === "unavailable" || status === "partial" || status === "provisional") {
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

  if (!failures.length) return { passed: true, failures: [] };
  return { passed: false, reason: "behavior_passed_coverage_insufficient", failureCategory: "coverage_below_threshold", failures };
}

export function exitCodeForRun(input: { runFailed: boolean; gatePassed: boolean; junitFailures: number }): number {
  return input.runFailed || !input.gatePassed || input.junitFailures > 0 ? 1 : 0;
}
