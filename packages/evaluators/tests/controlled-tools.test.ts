import { expect, it } from "vitest";
import { evaluateAgent } from "../src/index.js";
import type { Trajectory } from "@canary/core";
function trajectory(events: Array<{ type: string; name?: string; args?: unknown }>): Trajectory {
  return {
    id: "trajectory_controlled",
    runId: "run_controlled",
    caseId: "routing",
    events: events.map((event) => ({ ...event, timestamp: "2026-10-18T00:00:00Z" })),
    stepCount: 0,
    termination: "completed",
  };
}
it("uses managed name, arguments and order in controlled runs while ignoring contrary public claims", async () => {
  const result = await evaluateAgent({
    assertions: [
      { type: "tool.called", name: "lookup" },
      { type: "tool.args", name: "lookup", equals: { id: 7 } },
      { type: "tool.order", names: ["lookup", "save"] },
      { type: "trajectory.max_tool_calls", max: 2 },
    ],
    context: { toolCalls: 999 },
    trajectory: trajectory([
      { type: "canary.controlled.started" },
      { type: "tool.call", name: "wrong", args: { id: 1 } },
      { type: "canary.controlled.tool_call", name: "lookup", args: { id: 7 } },
      { type: "canary.controlled.tool_call", name: "save", args: {} },
    ]),
  });
  expect(result.passed).toBe(true);
});
it("never falls back to public claims when a controlled run has zero managed invocations", async () => {
  const result = await evaluateAgent({
    assertions: [{ type: "tool.called", name: "lookup" }],
    trajectory: trajectory([{ type: "canary.controlled.started" }, { type: "tool.call", name: "lookup" }]),
  });
  expect(result.passed).toBe(false);
});
it("keeps ordinary tool event assertions unchanged", async () => {
  const result = await evaluateAgent({
    assertions: [{ type: "tool.called", name: "lookup" }],
    trajectory: trajectory([{ type: "tool.call", name: "lookup" }]),
  });
  expect(result.passed).toBe(true);
});
