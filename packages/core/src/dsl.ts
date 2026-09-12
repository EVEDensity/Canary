import type { AssertionSpec, ExecutionTermination, OutputPredicate, SchemaLike, TestCase } from "./index.js";
import { parseTestCase } from "./schema.js";

export function defineCase(input: TestCase): TestCase {
  return parseTestCase(input) as TestCase;
}

export function defineCases(cases: TestCase[]): TestCase[] {
  return cases.map((item, index) => parseTestCase(item, `TestCase[${index}]`) as TestCase);
}

const output = () => ({
  exists: (): AssertionSpec => ({ type: "output.exists" }),
  schema: (schema: SchemaLike): AssertionSpec => ({ type: "output.schema", schema }),
  predicate: (predicate: OutputPredicate, message?: string): AssertionSpec => ({ type: "output.predicate", predicate, message }),
});

const trajectory = () => ({
  hasNoLoop: (): AssertionSpec => ({ type: "trajectory.forbidden_event", event: "loop_detected" }),
  maxSteps: (max: number): AssertionSpec => ({ type: "trajectory.max_steps", max }),
  maxToolCalls: (max: number): AssertionSpec => ({ type: "trajectory.max_tool_calls", max }),
  requiredEvent: (event: string, minCount?: number): AssertionSpec => ({ type: "trajectory.required_event", event, minCount }),
  forbiddenEvent: (event: string): AssertionSpec => ({ type: "trajectory.forbidden_event", event }),
  errorRecovery: (errorEvent?: string, recoveryEvent?: string): AssertionSpec => ({ type: "trajectory.error_recovery", errorEvent, recoveryEvent }),
});

function coverageFeature(featureId: string) {
  return {
    atLeast: (minPct: number): AssertionSpec => ({ type: "coverage.atLeast", featureId, minPct }),
    expected: (): AssertionSpec => ({ type: "feature.expected", featureId }),
  };
}
function coverageAtLeast(featureId: string, minPct: number): AssertionSpec {
  return coverageFeature(featureId).atLeast(minPct);
}
/** Dual API: `expect.coverage.atLeast(id, n)` and `expect.coverage().feature(id).atLeast(n)`. */
const coverage = Object.assign(
  function coverage() {
    return { feature: coverageFeature, atLeast: coverageAtLeast };
  },
  { feature: coverageFeature, atLeast: coverageAtLeast },
);

const judge = () => ({
  score: (options: { minScore?: number; minConfidence?: number; rubric?: string; timeoutMs?: number } = {}): AssertionSpec => ({
    type: "judge.score",
    ...options,
  }),
});

const tool = () => ({
  called: (name: string, minCount?: number): AssertionSpec => ({ type: "tool.called", name, minCount }),
  args: (name: string, match: { equals?: unknown; contains?: Record<string, unknown> }): AssertionSpec => ({ type: "tool.args", name, ...match }),
  order: (names: string[]): AssertionSpec => ({ type: "tool.order", names }),
});

const state = () => ({
  has: (key: string): AssertionSpec => ({ type: "state.has", key }),
  equals: (value: unknown, key?: string): AssertionSpec => ({ type: "state.equals", value, key }),
  contains: (contains: Record<string, unknown>): AssertionSpec => ({ type: "state.contains", contains }),
});

const policy = () => ({
  none: (): AssertionSpec => ({ type: "policy.none" }),
});

const execution = () => ({
  termination: (expected: ExecutionTermination): AssertionSpec => ({ type: "execution.termination", expected }),
  maxLatency: (maxMs: number): AssertionSpec => ({ type: "execution.max_latency", maxMs }),
  maxBudget: (max: number): AssertionSpec => ({ type: "execution.max_budget", max }),
});

/** Case-file assertion DSL. Import as `canaryExpect` in Vitest files to avoid clashing with `expect`. */
export const canaryExpect = {
  output,
  trajectory,
  coverage,
  judge,
  tool,
  state,
  policy,
  execution,
  feature: (featureId: string): AssertionSpec => ({ type: "feature.expected", featureId }),
};

export const expect = canaryExpect;
