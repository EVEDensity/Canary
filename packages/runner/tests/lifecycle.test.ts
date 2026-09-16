import { describe, expect, it } from "vitest";
import { budgetExceeded, classifyTermination, failureMessageFor } from "../src/lifecycle.js";

describe("R1 unified stop classification", () => {
  it("prefers cancel, then timeout, then budget, then error", () => {
    expect(classifyTermination({ cancelled: true, timeout: true, budgetExceeded: true, error: true })).toBe("cancelled");
    expect(classifyTermination({ timeout: true, budgetExceeded: true, error: true })).toBe("timeout");
    expect(classifyTermination({ budgetExceeded: true, error: true })).toBe("budget_exceeded");
    expect(classifyTermination({ error: true })).toBe("error");
    expect(classifyTermination({})).toBe("completed");
  });

  it("detects step, tool-call and cost budgets", () => {
    const events = [
      { type: "tool.call", timestamp: "2026-01-01T00:00:00.000Z", cost: 2 },
      { type: "tool_call", timestamp: "2026-01-01T00:00:00.000Z", cost: 3 },
    ];
    expect(budgetExceeded(events, { maxSteps: 1 })).toMatch(/maxSteps/);
    expect(budgetExceeded(events, { maxToolCalls: 1 })).toMatch(/maxToolCalls/);
    expect(budgetExceeded(events, { maxBudget: 4 })).toMatch(/maxBudget/);
    expect(budgetExceeded(events, { maxBudget: 5 })).toBeUndefined();
  });

  it("keeps a completed run without a failure message", () => {
    expect(failureMessageFor("completed", "ignored")).toBeUndefined();
    expect(failureMessageFor("timeout")).toBe("Execution timed out");
    expect(failureMessageFor("cancelled", "Execution cancelled")).toBe("Execution cancelled");
  });
});
