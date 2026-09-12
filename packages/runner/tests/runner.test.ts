import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runExecution } from "../src/index.js";

const options = (cwd: string, entry = "agent.mjs") => ({ cwd, entry, input: "ok", runId: "run_test", caseId: "case", timeoutMs: 1000, coverage: { rootDir: cwd, include: [entry] } });

describe("runner lifecycle", () => {
  it("returns a result and performs child cleanup after a successful agent", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-runner-"));
    writeFileSync(join(cwd, "agent.mjs"), "export default async (input, ctx) => { ctx.emit({ type: 'tool_call' }); return input; };", "utf8");
    const events: string[] = [];
    const result = await runExecution({ ...options(cwd), onEvent: (event) => events.push(event.type) });
    expect(result.passed).toBe(true); expect(events).toContain("execution.started"); expect(events).toContain("execution.finished"); expect(result.metrics?.steps).toBe(1);
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
