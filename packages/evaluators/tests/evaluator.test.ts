import { describe, expect, it } from "vitest";
import { evaluateAgent } from "../src/index.js";
import type { Trajectory } from "@canary/core";

const trajectory = (events: Trajectory["events"], termination: Trajectory["termination"] = "completed"): Trajectory => ({
  id: "t1", runId: "r1", caseId: "c1", events, stepCount: 3, termination,
});

const event = (type: string, extra: Record<string, unknown> = {}) => ({ type, timestamp: new Date().toISOString(), ...extra });

describe("deterministic Agent evaluator", () => {
  it("evaluates output existence, schema and predicate", async () => {
    const schema = { safeParse: (value: unknown) => ({ success: typeof value === "object" && value !== null }) };
    const result = await evaluateAgent({ output: { ok: true }, assertions: [
      { type: "output.exists" }, { type: "output.schema", schema },
      { type: "output.predicate", predicate: (value) => (value as { ok: boolean }).ok },
    ] });
    expect(result.passed).toBe(true);
    expect(result.assertions).toHaveLength(3);
  });

  it("checks trajectory events, limits, termination and recovery", async () => {
    const result = await evaluateAgent({ trajectory: trajectory([
      event("error"), event("recovery"), event("tool.call"), event("required"),
    ]), assertions: [
      { type: "trajectory.required_event", event: "required" },
      { type: "trajectory.forbidden_event", event: "forbidden" },
      { type: "trajectory.max_steps", max: 3 },
      { type: "trajectory.max_tool_calls", max: 1 },
      { type: "execution.termination", expected: "completed" },
      { type: "trajectory.error_recovery" },
    ] });
    expect(result.passed).toBe(true);
  });

  it("fails latency, budget and feature assertions deterministically", async () => {
    const result = await evaluateAgent({
      context: { latencyMs: 101, budgetUsed: 12, expectedFeatures: ["search"], featureStatuses: { search: "uncovered" } },
      assertions: [
        { type: "execution.max_latency", maxMs: 100 },
        { type: "execution.max_budget", max: 10 },
        { type: "feature.expected", featureId: "search" },
      ],
    });
    expect(result.passed).toBe(false);
    expect(result.assertions.every((item) => item.passed)).toBe(false);
  });

  it("supports parse-only schemas and reports unsupported assertions", async () => {
    const result = await evaluateAgent({ output: "ok", assertions: [
      { type: "output.schema", schema: { parse: (value: unknown) => { if (value !== "ok") throw new Error("bad"); return value; } } },
      { type: "unknown.assertion" },
    ] });
    expect(result.passed).toBe(false);
    expect(result.diagnostics?.[0]).toContain("Unsupported assertion");
  });
});
