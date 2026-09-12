import type { AssertionSpec, Trajectory } from "@canary/core";
import type { EvaluationContext, Evaluator } from "./evaluator-types.js";

export interface EvaluatorDescriptor {
  id: string;
  kind: "deterministic" | "judge" | "coverage" | "hard-gate";
  capabilities: string[];
  cost: "none" | "external";
  requiresData?: string[];
}

export class EvaluatorRegistry {
  private readonly evaluators = new Map<string, Evaluator>();
  private readonly descriptors = new Map<string, EvaluatorDescriptor>();

  register(evaluator: Evaluator, descriptor?: EvaluatorDescriptor): void {
    if (this.evaluators.has(evaluator.id)) throw new Error(`Duplicate evaluator id: ${evaluator.id}`);
    this.evaluators.set(evaluator.id, evaluator);
    this.descriptors.set(evaluator.id, descriptor ?? {
      id: evaluator.id,
      kind: "deterministic",
      capabilities: ["assertions"],
      cost: "none",
    });
  }

  get(id: string): Evaluator | undefined {
    return this.evaluators.get(id);
  }

  describe(id: string): EvaluatorDescriptor | undefined {
    return this.descriptors.get(id);
  }

  list(): EvaluatorDescriptor[] {
    return [...this.descriptors.values()];
  }

  async evaluate(id: string, input: { assertions: AssertionSpec[]; context?: EvaluationContext; trajectory?: Trajectory; output?: unknown }) {
    const evaluator = this.evaluators.get(id);
    if (!evaluator) throw new Error(`Unknown evaluator: ${id}`);
    return evaluator.evaluate(input);
  }
}

export const defaultEvaluatorRegistry = new EvaluatorRegistry();
