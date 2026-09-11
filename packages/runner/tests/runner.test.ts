import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runExecution } from "../src/index.js";

describe("runner lifecycle", () => {
  it("returns a result and performs child cleanup after a successful agent", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-runner-"));
    writeFileSync(join(cwd, "agent.mjs"), "export default async (input, ctx) => { ctx.emit({ type: 'tool_call' }); return input; };", "utf8");
    const events: string[] = [];
    const result = await runExecution({ cwd, entry: "agent.mjs", input: "ok", runId: "run_test", caseId: "case_ok", timeoutMs: 5_000, coverage: { rootDir: cwd, include: ["agent.mjs"] }, onEvent: (event) => events.push(event.type) });
    expect(result.passed).toBe(true);
    expect(events).toContain("execution.started");
    expect(events).toContain("execution.finished");
    expect(result.metrics?.steps).toBe(1);
  });

  it("records an agent exception without leaking the child", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-runner-"));
    writeFileSync(join(cwd, "agent.mjs"), "export default async () => { throw new Error('boom'); };", "utf8");
    const result = await runExecution({ cwd, entry: "agent.mjs", input: null, runId: "run_test", caseId: "case_error", timeoutMs: 5_000, coverage: { rootDir: cwd, include: ["agent.mjs"] } });
    expect(result.passed).toBe(false);
    expect(result.failureCategory).toBe("runtime_error");
  });
});
