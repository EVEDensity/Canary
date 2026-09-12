import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runExecution } from "../src/index.js";

const options = (cwd: string, entry = "agent.mjs") => ({ cwd, entry, input: "ok" as unknown, runId: "run_test", caseId: "case", timeoutMs: 1000, coverage: { rootDir: cwd, include: [entry] } });

describe("runner lifecycle", () => {
  it("returns a result and performs child cleanup after a successful agent", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-runner-"));
    writeFileSync(join(cwd, "agent.mjs"), "export default async (input, ctx) => { ctx.emit({ type: 'tool_call' }); return input; };", "utf8");
    const events: string[] = [];
    const result = await runExecution({ ...options(cwd), onEvent: (event) => events.push(event.type) });
    expect(result.passed).toBe(true); expect(events).toContain("execution.started"); expect(events).toContain("execution.finished"); expect(result.metrics?.steps).toBe(1);
    expect(result.trajectory?.events.some((event) => event.type === "tool_call")).toBe(true);
  });
  it("records an agent exception", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-runner-"));
    writeFileSync(join(cwd, "agent.mjs"), "export default async () => { throw new Error('boom'); };", "utf8");
    const result = await runExecution({ ...options(cwd), input: null });
    expect(result.passed).toBe(false); expect(result.failureCategory).toBe("runtime_error");
  });
  it("returns timeout for a stuck agent", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-runner-"));
    writeFileSync(join(cwd, "agent.mjs"), "export default async () => new Promise(() => {});", "utf8");
    const result = await runExecution({ ...options(cwd), timeoutMs: 50 });
    expect(result.passed).toBe(false); expect(result.failureCategory).toBe("timeout");
  });
  it("returns cancelled when the signal aborts", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-runner-"));
    writeFileSync(join(cwd, "agent.mjs"), "export default async () => new Promise(() => {});", "utf8");
    const controller = new AbortController();
    const pending = runExecution({ ...options(cwd), timeoutMs: 5000, signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    const result = await pending;
    expect(result.passed).toBe(false); expect(result.failureCategory).toBe("cancelled");
  });
});

describe("runner evaluation matrix", () => {
  it("passes when the agent completes and assertions succeed", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-runner-"));
    writeFileSync(join(cwd, "agent.mjs"), "export default async (input) => ({ ok: true, value: input });", "utf8");
    const result = await runExecution({
      ...options(cwd),
      testCase: { id: "case", input: "ok", assertions: [{ type: "output.exists" }, { type: "output.predicate", predicate: (value) => Boolean(value && typeof value === "object" && "ok" in value && value.ok) }] },
    });
    expect(result.passed).toBe(true);
    expect(result.failureCategory).toBeUndefined();
    expect(result.trajectory?.termination).toBe("completed");
  });

  it("fails evaluation when output assertions fail after a completed execution", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-runner-"));
    writeFileSync(join(cwd, "agent.mjs"), "export default async () => ({ ok: false });", "utf8");
    const result = await runExecution({
      ...options(cwd),
      testCase: { id: "case", input: "ok", assertions: [{ type: "output.predicate", predicate: (value) => Boolean(value && typeof value === "object" && "ok" in value && value.ok) }] },
    });
    expect(result.passed).toBe(false);
    expect(result.failureCategory).toBe("assertion_failed");
    expect(result.assertions.some((item) => item.id.startsWith("output.predicate") && !item.passed)).toBe(true);
  });

  it("fails when a required trajectory event is missing", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-runner-"));
    writeFileSync(join(cwd, "agent.mjs"), "export default async () => ({ ok: true });", "utf8");
    const result = await runExecution({
      ...options(cwd),
      testCase: { id: "case", input: "ok", assertions: [{ type: "trajectory.required_event", event: "tool.call" }] },
    });
    expect(result.passed).toBe(false);
    expect(result.failureCategory).toBe("assertion_failed");
  });
});

describe("provisional coverage sampling", () => {
  it("emits provisional then final coverage and throttles duplicate samples", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-runner-"));
    writeFileSync(join(cwd, "agent.mjs"), "export default async () => { await new Promise((resolve) => setTimeout(resolve, 180)); return 'ok'; };", "utf8");
    const statuses: string[] = [];
    const result = await runExecution({
      ...options(cwd),
      timeoutMs: 5000,
      coverage: { rootDir: cwd, include: ["agent.mjs"], sampleIntervalMs: 20, sampleMinIntervalMs: 80 },
      onCoverage: (coverage) => statuses.push(coverage.status),
    });
    expect(result.passed).toBe(true);
    expect(statuses).toContain("provisional");
    expect(statuses.at(-1)).toBe("final");
    expect(statuses.filter((status) => status === "provisional").length).toBeLessThan(8);
  });
});
