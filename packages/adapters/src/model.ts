import type { ModelCompletion, ModelProvider, ModelProviderKind } from "@canary/core";

export type { ModelCompletion, ModelProvider, ModelProviderKind };

/**
 * Independent ModelProvider module (Agent / Model / Tool / Coverage split).
 * This is the agent-side completer, not `@canary/evaluators` JudgeProvider.
 */
export class DeterministicModelProvider implements ModelProvider {
  readonly kind = "deterministic" as const;
  constructor(private readonly responses: Record<string, string> = {}) {}
  async complete(prompt: string): Promise<ModelCompletion> {
    if (this.responses[prompt] !== undefined) return { text: this.responses[prompt] };
    if (prompt.startsWith("plan:")) return { text: `planned:${prompt.slice("plan:".length)}` };
    return { text: prompt };
  }
}

export class EchoModelProvider implements ModelProvider {
  readonly kind = "echo" as const;
  async complete(prompt: string): Promise<ModelCompletion> { return { text: prompt }; }
}

export function createModelProvider(kind: ModelProviderKind = "deterministic", responses?: Record<string, string>): ModelProvider {
  return kind === "echo" ? new EchoModelProvider() : new DeterministicModelProvider(responses);
}
