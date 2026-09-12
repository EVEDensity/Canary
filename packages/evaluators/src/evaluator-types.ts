import type {
  AssertionSpec,
  CoverageSummary,
  EvalResult,
  ExecutionTermination,
  TestCase,
  Trajectory,
} from "@canary/core";
import type { JudgePolicy, JudgeProvider } from "./judge.js";

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
  coverage?: CoverageSummary;
  judge?: JudgeProvider;
  judgePolicy?: JudgePolicy;
  state?: unknown;
}

export interface Evaluator {
  id: string;
  evaluate(input: { assertions: AssertionSpec[]; context?: EvaluationContext; trajectory?: Trajectory; output?: unknown }): Promise<Pick<EvalResult, "passed" | "assertions"> & { diagnostics?: string[] }>;
}
