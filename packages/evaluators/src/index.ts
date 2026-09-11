import type { AssertionSpec, EvalResult, Trajectory } from "@canary/core";
export interface Evaluator { id: string; evaluate(input: { assertions: AssertionSpec[]; trajectory?: Trajectory }): Promise<Pick<EvalResult, "passed" | "assertions">>; }
export const passEmptyEvaluation = async (): Promise<Pick<EvalResult, "passed" | "assertions">> => ({ passed: true, assertions: [] });
