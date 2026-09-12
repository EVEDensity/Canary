import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlTraceStore, queryEvents, redactEvent, redactTrajectory } from "../src/index.js";
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

  it("appends redacted JSONL events to a durable store", () => {
    const dir = mkdtempSync(join(tmpdir(), "canary-trace-"));
    const store = new JsonlTraceStore(join(dir, "trace.jsonl"));
    store.append({ type: "tool.call", timestamp: "t", apiKey: "sk-live", prompt: "hello" });
    const line = JSON.parse(readFileSync(join(dir, "trace.jsonl"), "utf8").trim());
    expect(line.type).toBe("tool.call");
    expect(line.apiKey).toBe("[redacted]");
    expect(line.prompt).toBe("hello");
  });
});
