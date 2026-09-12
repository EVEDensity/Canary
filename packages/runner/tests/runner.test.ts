import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { killProcessTree, mapLimit, runConfiguredCase, runExecution, runHttpExecution, runMcpExecution } from "../src/index.js";

const options = (cwd: string, entry = "agent.mjs") => ({ cwd, entry, input: "ok" as unknown, runId: "run_test", caseId: "case", timeoutMs: 1000, coverage: { rootDir: cwd, include: [entry] } });

describe("runner lifecycle", () => {
  it("returns a result and performs child cleanup after a successful agent", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-runner-"));
    writeFileSync(join(cwd, "agent.mjs"), "export default async (input, ctx) => { ctx.emit({ type: 'tool_call' }); return input; };", "utf8");
    const events: string[] = [];
    const result = await runExecution({ ...options(cwd), onEvent: (event) => events.push(event.type) });
    expect(result.passed).toBe(true); expect(events).toContain("execution.started"); expect(events).toContain("execution.finished"); expect(result.metrics?.steps).toBe(1);
    expect(result.trajectory?.events.some((event) => event.type === "tool_call")).toBe(true);
    expect(result.stateDiff?.changed).toBeDefined();
    expect(result.coverage.lifecycle).toEqual({ initCaptured: true, taskWindow: "reset-after-init" });
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
  it("times out a synchronous busy-loop and SIGKILL-escalates the process tree", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-busy-"));
    writeFileSync(join(cwd, "agent.mjs"), "export default async () => { for (;;) {} };", "utf8");
    const started = Date.now();
    const result = await runExecution({ ...options(cwd), timeoutMs: 200, killGraceMs: 80 });
    expect(result.passed).toBe(false);
    expect(result.failureCategory).toBe("timeout");
    expect(result.trajectory?.termination).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(8_000);
  }, 15_000);
  it("kills a detached busy-loop with killProcessTree", async () => {
    const child = spawn(process.execPath, ["-e", "for(;;){}"], {
      detached: process.platform !== "win32",
      stdio: "ignore",
    });
    expect(child.pid).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 40));
    killProcessTree(child.pid!);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("busy-loop process still alive after SIGKILL")), 4_000);
      child.once("close", () => { clearTimeout(timer); resolve(); });
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
  }, 10_000);
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
    expect(result.failureCategory).toBe("wrong_output");
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

  it("records state_mismatch when a state assertion fails after a completed agent", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-state-"));
    writeFileSync(join(cwd, "agent.mjs"), "export default async () => ({ ok: true });", "utf8");
    const result = await runExecution({
      ...options(cwd),
      testCase: { id: "case", input: "ok", assertions: [{ type: "state.has", key: "lastTool" }] },
    });
    expect(result.passed).toBe(false);
    expect(result.failureCategory).toBe("state_mismatch");
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

  it("collects exact istanbul coverage when the provider is opted in", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-istanbul-"));
    writeFileSync(join(cwd, "agent.mjs"), "export default async function one(value) { if (value) return true; else return false; }\n", "utf8");
    const result = await runExecution({
      ...options(cwd),
      input: true,
      timeoutMs: 8_000,
      coverage: { rootDir: cwd, include: ["agent.mjs"], provider: "istanbul" },
    });
    expect(result.passed).toBe(true);
    expect(result.coverage.status).toBe("final");
    expect(result.coverage.lines.total).toBeGreaterThan(0);
    expect(result.coverage.files?.some((file) => file.quality?.precision === "exact" && file.quality.mappingMode === "ast")).toBe(true);
  });
});

describe("http black-box adapter", () => {
  it("marks coverage unavailable when the agent is a remote HTTP endpoint", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ output: "remote" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    try {
      const result = await runHttpExecution({
        entry: `http://127.0.0.1:${port}/agent`,
        input: { goal: "remote" },
        runId: "run_http",
        caseId: "http-case",
        timeoutMs: 2000,
        coverage: { include: ["**/*.ts"] },
      });
      expect(result.passed).toBe(true);
      expect(result.coverage.status).toBe("unavailable");
      expect(result.coverage.lines.total).toBe(0);
      const configured = await runConfiguredCase({
        config: { agent: { adapter: "http", entry: `http://127.0.0.1:${port}/agent` }, cases: "none", coverage: { include: [] } },
        runId: "run_http_cfg",
      }, { id: "http-case", input: { goal: "remote" } });
      expect(configured.coverage.status).toBe("unavailable");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("mcp agent adapter and process pool", () => {
  it("marks coverage unavailable for an MCP stdio agent", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-mcp-"));
    writeFileSync(join(cwd, "mcp-agent.mjs"), "process.stdin.setEncoding('utf8'); let b=''; process.stdin.on('data',c=>{b+=c; const i=b.indexOf('\\n'); if(i>=0){ const m=JSON.parse(b.slice(0,i)); process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{output:m.params.arguments}})+'\\n'); }});", "utf8");
    const result = await runMcpExecution({
      cwd,
      entry: "mcp-agent.mjs",
      input: { goal: "mcp" },
      runId: "run_mcp",
      caseId: "mcp-case",
      timeoutMs: 5000,
      coverage: { include: ["mcp-agent.mjs"] },
    });
    expect(result.passed).toBe(true);
    expect(result.coverage.status).toBe("unavailable");
    expect(result.output).toEqual({ output: { goal: "mcp" } });
    const configured = await runConfiguredCase({
      cwd,
      config: { agent: { adapter: "mcp", entry: "./mcp-agent.mjs" }, cases: "none", coverage: { include: ["mcp-agent.mjs"] } },
      runId: "run_mcp_cfg",
    }, { id: "mcp-case", input: { goal: "mcp" } });
    expect(configured.coverage.status).toBe("unavailable");
  });

  it("runs mapLimit with a bounded pool and preserves order", async () => {
    const seen: number[] = [];
    const result = await mapLimit([1, 2, 3, 4], 2, async (value) => {
      seen.push(value);
      await new Promise((resolve) => setTimeout(resolve, 15));
      return value * 2;
    });
    expect(result).toEqual([2, 4, 6, 8]);
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });

  it("overlaps work when mapLimit concurrency is greater than 1", async () => {
    const started: number[] = [];
    const finished: number[] = [];
    await mapLimit([1, 2], 2, async () => {
      started.push(Date.now());
      await new Promise((resolve) => setTimeout(resolve, 50));
      finished.push(Date.now());
    });
    expect(Math.min(...finished) - Math.max(...started)).toBeGreaterThan(20);
  });
});
