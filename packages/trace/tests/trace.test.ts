import { describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AsyncJsonlTraceStore, JsonlTraceStore, queryEvents, readJsonl, redactEvalResult, redactEvent, redactTrajectory } from "../src/index.js";
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
    expect(line.v).toBe(1);
    expect(line.apiKey).toBe("[redacted]");
    expect(line.prompt).toBe("hello");
  });

  it("reads old JSONL and skips a truncated trailing line", () => {
    const dir = mkdtempSync(join(tmpdir(), "canary-trace-old-"));
    const file = join(dir, "trace.jsonl");
    appendFileSync(file, `${JSON.stringify({ type: "legacy", apiKey: "x" })}\n{"type":"partial`, "utf8");
    const rows = readJsonl(file) as Array<{ type: string }>;
    expect(rows).toEqual([{ type: "legacy", apiKey: "x" }]);
  });

  it("applies backpressure on the async sink and redacts eval results", async () => {
    const dir = mkdtempSync(join(tmpdir(), "canary-trace-async-"));
    const store = new AsyncJsonlTraceStore(join(dir, "trace.jsonl"), { maxQueue: 2 });
    await store.append({ type: "a", token: "secret" });
    await store.append({ type: "b" });
    await store.append({ type: "c" });
    await store.close();
    const rows = readJsonl(join(dir, "trace.jsonl")) as Array<{ type: string; token?: string }>;
    expect(rows.map((row) => row.type)).toEqual(["a", "b", "c"]);
    expect(rows[0]?.token).toBe("[redacted]");
    const redacted = redactEvalResult({
      runId: "r", executionId: "e", caseId: "c", passed: true, assertions: [],
      coverage: { runId: "r", sourceHash: "h", status: "unavailable", lines: { covered: 0, total: 0, pct: 0 }, statements: { covered: 0, total: 0, pct: 0 }, functions: { covered: 0, total: 0, pct: 0 }, branches: { covered: 0, total: 0, pct: 0 }, featureChains: [] },
      input: { apiKey: "sk" },
      output: { password: "p" },
    });
    expect(redacted.input).toEqual({ apiKey: "[redacted]" });
    expect(redacted.output).toEqual({ password: "[redacted]" });
  });
});
