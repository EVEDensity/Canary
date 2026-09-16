import type { ExecutionTermination, TrajectoryEvent } from "@canary/core";

export type ExecutionStopReason = "completed" | "timeout" | "cancelled" | "budget_exceeded" | "error";

export interface BudgetLimits {
  maxSteps?: number;
  maxToolCalls?: number;
  maxBudget?: number;
}

export interface ExecutionFlags {
  cancelled?: boolean;
  timeout?: boolean;
  budgetExceeded?: boolean;
  error?: boolean;
}

export function budgetUsed(events: readonly TrajectoryEvent[]): number {
  return events.reduce(
    (total, event) =>
      total + (typeof event.cost === "number" ? event.cost : typeof event.budgetUsed === "number" ? event.budgetUsed : 0),
    0,
  );
}

export function toolCallCount(events: readonly TrajectoryEvent[]): number {
  return events.filter((event) => event.type === "tool_call" || event.type === "tool.call").length;
}

export function budgetExceeded(events: readonly TrajectoryEvent[], limits: BudgetLimits = {}): string | undefined {
  const steps = toolCallCount(events);
  const used = budgetUsed(events);
  if (limits.maxSteps !== undefined && steps > limits.maxSteps) return `Execution exceeded maxSteps ${limits.maxSteps}`;
  if (limits.maxToolCalls !== undefined && steps > limits.maxToolCalls)
    return `Execution exceeded maxToolCalls ${limits.maxToolCalls}`;
  if (limits.maxBudget !== undefined && used > limits.maxBudget) return `Execution exceeded maxBudget ${limits.maxBudget}`;
  return undefined;
}

/** Cancel wins over timeout; expected-failure assertions still decide pass/fail later. */
export function classifyTermination(flags: ExecutionFlags): ExecutionTermination {
  if (flags.cancelled) return "cancelled";
  if (flags.timeout) return "timeout";
  if (flags.budgetExceeded) return "budget_exceeded";
  if (flags.error) return "error";
  return "completed";
}

export function classifyRemoteFailure(
  error: unknown,
  flags: ExecutionFlags,
): { failure: string; termination: ExecutionTermination } {
  const message = error instanceof Error ? error.message : String(error);
  const termination = classifyTermination({ ...flags, error: true });
  return { failure: failureMessageFor(termination, message) ?? message, termination };
}

export function failureMessageFor(termination: ExecutionTermination, detail?: string): string | undefined {
  if (termination === "completed") return undefined;
  if (detail) return detail;
  if (termination === "timeout") return "Execution timed out";
  if (termination === "cancelled") return "Execution cancelled";
  if (termination === "budget_exceeded") return "Execution exceeded budget";
  return "Execution failed";
}
