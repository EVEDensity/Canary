import { describe, expect, it } from "vitest";
import { queryEvents, redactEvent, redactTrajectory } from "../src/index.js";
import type { Trajectory } from "@canary/core";

describe("trace redaction and query", () => {
  it("redacts secrets and truncates large fields", () => {
    const event = redactEvent({ type: "tool.call", timestamp: "t", apiKey: "sk-live", prompt: "x".repeat(40), nested: { token: "abc" } }, { maxStringLength: 8 });
    expect(event.apiKey).toBe("[redacted]");
    expect((event.nested as { token: string }).token).toBe("[redacted]");
    expect(String(event.prompt).startsWith("xxxxxxxx")).toBe(true);
    expect(String(event.prompt).endsWith("…")).toBe(true);
  });

  it("queries trajectory events by type and feature", () => {
    const trajectory: Trajectory = {
      id: "t1", runId: "r1", caseId: "c1", termination: "completed", stepCount: 2,
      events: [
        { type: "feature.enter", timestamp: "t", featureId: "planning" },
        { type: "tool.call", timestamp: "t", name: "lookup" },
        { type: "feature.exit", timestamp: "t", featureId: "planning" },
      ],
    };
    expect(queryEvents(trajectory.events, { type: "tool.call" })).toHaveLength(1);
    expect(queryEvents(redactTrajectory(trajectory).events, { featureId: "planning" })).toHaveLength(2);
  });
});
