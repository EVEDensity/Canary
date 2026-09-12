import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverCaseFiles, globToRegExp, listRunArtifacts, loadCases, main, readRunArtifact, runCommandDetailed } from "../src/index.js";

describe("case discovery", () => {
  it("lets ** match zero or more directories", () => {
    const matcher = globToRegExp("cases/**/*.ts");
    expect(matcher.test("cases/smoke.ts")).toBe(true);
    expect(matcher.test("cases/a/b.ts")).toBe(true);
    expect(matcher.test("other/smoke.ts")).toBe(false);
  });

  it("discovers nested and flat case files and rejects invalid or duplicate cases", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-cases-"));
    mkdirSync(join(cwd, "cases", "nested"), { recursive: true });
    writeFileSync(join(cwd, "cases", "smoke.ts"), "export default { id: 'smoke', input: 'ok' };", "utf8");
    writeFileSync(join(cwd, "cases", "nested", "deep.ts"), "export default { id: 'deep', input: 'ok' };", "utf8");
    const files = await discoverCaseFiles("cases/**/*.ts", cwd);
    expect(files.some((file) => file.replaceAll("\\", "/").endsWith("cases/smoke.ts"))).toBe(true);
    expect(files.some((file) => file.replaceAll("\\", "/").endsWith("cases/nested/deep.ts"))).toBe(true);
    const loaded = await loadCases("cases/**/*.ts", cwd);
    expect(loaded.map((item) => item.id)).toEqual(["deep", "smoke"]);
    writeFileSync(join(cwd, "cases", "bad.ts"), "export default { id: 1, input: 'x' };", "utf8");
    await expect(loadCases("cases/**/*.ts", cwd)).rejects.toThrow(/Invalid TestCase schema/);
    writeFileSync(join(cwd, "cases", "bad.ts"), "export default { id: 'smoke', input: 'dup' };", "utf8");
    await expect(loadCases("cases/**/*.ts", cwd)).rejects.toThrow(/Duplicate test case id: smoke/);
    await expect(loadCases("missing/**/*.ts", cwd)).rejects.toThrow(/No test case files matched/);
  });
});

describe("canary run --headless", () => {
  it("writes run.json and places coverage in the RunStore", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-cli-"));
    writeFileSync(join(cwd, "agent.mjs"), "export default async (input, ctx) => { ctx.emit({ type: 'tool_call', name: 'echo' }); return { value: input }; };", "utf8");
    writeFileSync(join(cwd, "cases.ts"), "export default [{ id: 'smoke', input: 'ok' }];", "utf8");
    writeFileSync(join(cwd, "canary.config.ts"), `export default { agent: { adapter: 'function', entry: './agent.mjs' }, cases: './cases.ts', coverage: { include: ['agent.mjs'], exclude: [] }, web: { host: '127.0.0.1', open: false } };`, "utf8");
    const result = await runCommandDetailed({ cwd, headless: true, noOpen: true });
    expect(result.exitCode).toBe(0); expect(existsSync(result.artifactPath)).toBe(true);
    const artifact = JSON.parse(readFileSync(result.artifactPath, "utf8"));
    const dir = join(cwd, ".canary/artifacts", result.runId);
    expect(existsSync(join(dir, "coverage-manifest.json"))).toBe(true);
    expect(existsSync(join(dir, "coverage.json"))).toBe(true);
    const trajectory = JSON.parse(readFileSync(join(dir, "trajectory.json"), "utf8"));
    const evaluator = JSON.parse(readFileSync(join(dir, "evaluator.json"), "utf8"));
    expect(artifact.runId).toBe(result.runId);
    expect(artifact.coverage.lines.total).toBeGreaterThan(0);
    expect(artifact.results[0].output).toBeDefined();
    expect(artifact.results[0].coverage).toBeDefined();
    expect(artifact.results[0].trajectory.events.some((event: { type: string }) => event.type === "tool_call")).toBe(true);
    expect(trajectory[0].events.some((event: { type: string }) => event.type === "tool_call")).toBe(true);
    expect(evaluator[0].evaluation.status).toBe("passed");
    expect(existsSync(join(dir, "report.json"))).toBe(true);
    expect(existsSync(join(dir, "report.md"))).toBe(true);
    expect(existsSync(join(dir, "report.xml"))).toBe(true);
    expect(existsSync(join(dir, "improvement.json"))).toBe(true);
    expect(existsSync(join(dir, "trace.jsonl"))).toBe(true);
    const traceLine = readFileSync(join(dir, "trace.jsonl"), "utf8").trim().split("\n")[0];
    expect(JSON.parse(traceLine ?? "{}").type).toBeDefined();
    expect(result.store.get(result.runId)?.coverage?.lines.total).toBeGreaterThan(0);
    expect(listRunArtifacts(cwd).some((run) => run.runId === result.runId)).toBe(true);
    expect(readRunArtifact(result.runId, cwd)?.coverage?.status).toBe("final");
  });

  it("fails the shared coverage gate when required coverage is below threshold", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-gate-"));
    writeFileSync(join(cwd, "agent.mjs"), "export default async (input) => ({ value: input });\nfunction unused(flag) { if (flag) return 1; return 0; }\n", "utf8");
    writeFileSync(join(cwd, "cases.ts"), "export default [{ id: 'smoke', input: 'ok', assertions: [{ type: 'output.exists' }] }];", "utf8");
    writeFileSync(join(cwd, "canary.config.ts"), `export default { agent: { adapter: 'function', entry: './agent.mjs' }, cases: './cases.ts', coverage: { include: ['agent.mjs'], exclude: [], branches: 100 }, web: { host: '127.0.0.1', open: false } };`, "utf8");
    const result = await runCommandDetailed({ cwd, headless: true, noOpen: true });
    expect(result.exitCode).toBe(1);
    const gate = JSON.parse(readFileSync(join(cwd, ".canary/artifacts", result.runId, "gate.json"), "utf8"));
    expect(gate.passed).toBe(false);
    expect(gate.failureCategory).toBe("coverage_below_threshold");
    const xml = readFileSync(join(cwd, ".canary/artifacts", result.runId, "report.xml"), "utf8");
    expect(xml).toContain("coverage.gate");
    expect(xml).toMatch(/failures="[1-9]/);
  });
});

describe("improvement CLI loop", () => {
  it("exports regression drafts from a failed run and rejects a holdout regression on compare", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-improve-"));
    writeFileSync(join(cwd, "agent.mjs"), "export default async (input) => input === 'x' ? null : { value: input };", "utf8");
    writeFileSync(join(cwd, "cases.ts"), "export default [{ id: 'safe', input: 'ok', assertions: [{ type: 'output.exists' }] }, { id: 'broken', input: 'x', assertions: [{ type: 'output.exists' }] }];", "utf8");
    writeFileSync(join(cwd, "canary.config.ts"), `export default { agent: { adapter: 'function', entry: './agent.mjs' }, cases: './cases.ts', coverage: { include: ['agent.mjs'], exclude: [] }, web: { host: '127.0.0.1', open: false } };`, "utf8");
    const failed = await runCommandDetailed({ cwd, headless: true, noOpen: true });
    expect(failed.exitCode).toBe(1);
    const previousCwd = process.env.INIT_CWD;
    process.env.INIT_CWD = cwd;
    try {
      const improveCode = await main(["improve", failed.runId, "--out", join(cwd, "cases/regression")]);
      expect(improveCode).toBe(0);
      expect(existsSync(join(cwd, "cases/regression", "broken.regression.ts"))).toBe(true);
      expect(readFileSync(join(cwd, "cases/regression", "broken.regression.ts"), "utf8")).toContain("broken.regression");
    } finally {
      process.env.INIT_CWD = previousCwd;
    }

    writeFileSync(join(cwd, "agent.mjs"), "export default async (input) => ({ value: input });", "utf8");
    writeFileSync(join(cwd, "cases.ts"), "export default [{ id: 'safe', input: 'ok', assertions: [{ type: 'output.exists' }] }, { id: 'holdout-planning', input: 'holdout', assertions: [{ type: 'output.exists' }] }];", "utf8");
    const baseline = await runCommandDetailed({ cwd, headless: true, noOpen: true });
    expect(baseline.exitCode).toBe(0);
    writeFileSync(join(cwd, "agent.mjs"), "export default async (input) => String(input).includes('holdout') ? null : { value: input };", "utf8");
    const candidate = await runCommandDetailed({ cwd, headless: true, noOpen: true });
    expect(candidate.exitCode).toBe(1);
    process.env.INIT_CWD = cwd;
    try {
      const compareCode = await main(["compare", baseline.runId, candidate.runId]);
      expect(compareCode).toBe(1);
    } finally {
      process.env.INIT_CWD = previousCwd;
    }
  });

  it("accepts and verifies a suggestion then runs a one-click candidate pipeline", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-candidate-"));
    writeFileSync(join(cwd, "broken.mjs"), "export default async (input) => input === 'broken' ? null : { value: input };", "utf8");
    writeFileSync(join(cwd, "fixed.mjs"), "export default async (input) => ({ value: input });", "utf8");
    writeFileSync(join(cwd, "cases.ts"), "export default [{ id: 'safe', input: 'ok', assertions: [{ type: 'output.exists' }] }, { id: 'broken', input: 'broken', assertions: [{ type: 'output.exists' }] }, { id: 'holdout-planning', input: 'holdout', assertions: [{ type: 'output.exists' }] }];", "utf8");
    writeFileSync(join(cwd, "canary.config.ts"), `export default { agent: { adapter: 'function', entry: './broken.mjs' }, cases: './cases.ts', coverage: { include: ['broken.mjs', 'fixed.mjs'], exclude: [] }, web: { host: '127.0.0.1', open: false } };`, "utf8");
    const baseline = await runCommandDetailed({ cwd, headless: true, noOpen: true });
    expect(baseline.exitCode).toBe(1);
    const previousCwd = process.env.INIT_CWD;
    process.env.INIT_CWD = cwd;
    try {
      expect(await main(["improve", baseline.runId, "--out", join(cwd, "cases/drafts")])).toBe(0);
      const suggestions = JSON.parse(readFileSync(join(cwd, ".canary/artifacts", baseline.runId, "improvement.json"), "utf8")) as Array<{ id: string; kind: string; caseId: string }>;
      const target = suggestions.find((item) => item.caseId === "broken");
      expect(target?.kind).toBe("wrong_output");
      expect(await main(["suggest", baseline.runId, "--accept", target!.id])).toBe(0);
      expect(await main(["suggest", baseline.runId, "--verify", target!.id, "--out", join(cwd, "cases/regression")])).toBe(0);
      expect(existsSync(join(cwd, "cases/regression", "broken.regression.ts"))).toBe(true);
      expect(readFileSync(join(cwd, "cases/regression", "broken.regression.ts"), "utf8")).toContain("verified");
      const code = await main(["candidate", baseline.runId, "--entry", "./fixed.mjs", "--headless", "--no-open"]);
      expect(code).toBe(0);
      const candidateId = listRunArtifacts(cwd).find((run) => existsSync(join(cwd, ".canary/artifacts", run.runId, "comparison.json")))?.runId;
      expect(candidateId).toBeTruthy();
      const comparison = JSON.parse(readFileSync(join(cwd, ".canary/artifacts", candidateId!, "comparison.json"), "utf8"));
      expect(comparison.verdict).toBe("improve");
      expect(comparison.improvements).toContain("broken");
    } finally {
      process.env.INIT_CWD = previousCwd;
    }
  });

  it("fails the policy hard gate on unexpected violations even when output exists", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-policy-"));
    writeFileSync(join(cwd, "agent.mjs"), "export default async (input, ctx) => { ctx.emit({ type: 'policy.violation', rule: 'no-exfil' }); return { value: input }; };", "utf8");
    writeFileSync(join(cwd, "cases.ts"), "export default [{ id: 'smoke', input: 'ok', assertions: [{ type: 'output.exists' }] }];", "utf8");
    writeFileSync(join(cwd, "canary.config.ts"), `export default { agent: { adapter: 'function', entry: './agent.mjs' }, cases: './cases.ts', coverage: { include: ['agent.mjs'] }, web: { host: '127.0.0.1', open: false } };`, "utf8");
    const result = await runCommandDetailed({ cwd, headless: true, noOpen: true });
    expect(result.exitCode).toBe(1);
    const gate = JSON.parse(readFileSync(join(cwd, ".canary/artifacts", result.runId, "gate.json"), "utf8"));
    expect(gate.passed).toBe(false);
    expect(gate.reason).toBe("hard_gate_failed");
    expect(gate.hardGate.policyViolations).toBeGreaterThan(0);
  });
});

describe("canary replay", () => {
  it("re-executes the source run cases into a new artifact tagged replayOf", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-replay-"));
    writeFileSync(join(cwd, "agent.mjs"), "export default async (input) => ({ value: input });", "utf8");
    writeFileSync(join(cwd, "cases.ts"), "export default [{ id: 'smoke', input: 'ok', assertions: [{ type: 'output.exists' }] }];", "utf8");
    writeFileSync(join(cwd, "canary.config.ts"), `export default { agent: { adapter: 'function', entry: './agent.mjs' }, cases: './cases.ts', coverage: { include: ['agent.mjs'], exclude: [] }, web: { host: '127.0.0.1', open: false } };`, "utf8");
    const first = await runCommandDetailed({ cwd, headless: true, noOpen: true });
    expect(first.exitCode).toBe(0);
    const previousCwd = process.env.INIT_CWD;
    process.env.INIT_CWD = cwd;
    try {
      const code = await main(["replay", first.runId, "--headless", "--no-open"]);
      expect(code).toBe(0);
    } finally {
      process.env.INIT_CWD = previousCwd;
    }
    const replayed = listRunArtifacts(cwd).find((run) => run.replayOf === first.runId);
    expect(replayed?.runId).not.toBe(first.runId);
    expect(replayed?.passedCases).toBe(1);
  });
});

describe("repetitions, tags, cancel and streaming artifacts", () => {
  it("runs case × repetitions and filters --tag", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-reps-"));
    writeFileSync(join(cwd, "agent.mjs"), "export default async (input) => ({ value: input });", "utf8");
    writeFileSync(join(cwd, "cases.ts"), "export default [{ id: 'smoke', tags: ['fast'], input: 'ok', assertions: [{ type: 'output.exists' }] }, { id: 'slow', tags: ['slow'], input: 'later', assertions: [{ type: 'output.exists' }] }];", "utf8");
    writeFileSync(join(cwd, "canary.config.ts"), `export default { agent: { adapter: 'function', entry: './agent.mjs' }, cases: './cases.ts', coverage: { include: ['agent.mjs'], exclude: [] }, reporters: ['console', 'json'], web: { host: '127.0.0.1', open: false } };`, "utf8");
    const tagged = await runCommandDetailed({ cwd, headless: true, noOpen: true, tags: ["fast"], repetitions: 2 });
    expect(tagged.exitCode).toBe(0);
    const artifact = JSON.parse(readFileSync(tagged.artifactPath, "utf8"));
    expect(artifact.totalCases).toBe(2);
    expect(artifact.results).toHaveLength(2);
    expect(artifact.results.every((item: { caseId: string }) => item.caseId === "smoke")).toBe(true);
    expect(artifact.results.map((item: { repetition: number }) => item.repetition)).toEqual([1, 2]);
    expect(existsSync(join(cwd, ".canary/artifacts", tagged.runId, "report.console.txt"))).toBe(true);
  });

  it("writes a cancelled artifact when the run is aborted", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-cancel-"));
    writeFileSync(join(cwd, "agent.mjs"), "export default async () => new Promise(() => {});", "utf8");
    writeFileSync(join(cwd, "cases.ts"), "export default [{ id: 'stuck', input: 'ok' }];", "utf8");
    writeFileSync(join(cwd, "canary.config.ts"), `export default { agent: { adapter: 'function', entry: './agent.mjs' }, cases: './cases.ts', coverage: { include: ['agent.mjs'], exclude: [] }, web: { host: '127.0.0.1', open: false } };`, "utf8");
    const controller = new AbortController();
    controller.abort();
    const result = await runCommandDetailed({ cwd, headless: true, noOpen: true, signal: controller.signal });
    expect(result.exitCode).toBe(1);
    expect(existsSync(result.artifactPath)).toBe(true);
    const artifact = JSON.parse(readFileSync(result.artifactPath, "utf8"));
    expect(artifact.status).toBe("cancelled");
    expect(artifact.coverage.status).toBe("preparing");
    expect(existsSync(join(cwd, ".canary/artifacts", result.runId, "coverage.json"))).toBe(true);
    expect(existsSync(join(cwd, ".canary/artifacts", result.runId, "coverage-manifest.json"))).toBe(true);
  });

  it("cancels an in-flight case and persists the partial run", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-cancel-live-"));
    writeFileSync(join(cwd, "agent.mjs"), "export default async () => new Promise(() => {});", "utf8");
    writeFileSync(join(cwd, "cases.ts"), "export default [{ id: 'stuck', input: 'ok' }];", "utf8");
    writeFileSync(join(cwd, "canary.config.ts"), `export default { agent: { adapter: 'function', entry: './agent.mjs' }, cases: './cases.ts', coverage: { include: ['agent.mjs'], exclude: [] }, runtime: { timeoutMs: 5000 }, web: { host: '127.0.0.1', open: false } };`, "utf8");
    const controller = new AbortController();
    const pending = runCommandDetailed({ cwd, headless: true, noOpen: true, signal: controller.signal });
    setTimeout(() => controller.abort(), 250);
    const result = await pending;
    expect(result.exitCode).toBe(1);
    const artifact = JSON.parse(readFileSync(result.artifactPath, "utf8"));
    expect(artifact.status).toBe("cancelled");
    expect(artifact.results[0]?.failureCategory).toBe("cancelled");
  });
});

describe("tool adapters, http black-box and concurrency", () => {
  it("injects MockToolAdapter so the agent uses ctx.tools.call", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-mock-tools-"));
    writeFileSync(join(cwd, "tools.mjs"), "export const demoTools = { echo: (args) => ({ echoed: args }) };", "utf8");
    writeFileSync(join(cwd, "agent.mjs"), "export default async (input, ctx) => { const args = { q: input }; ctx.emit({ type: 'tool.call', name: 'echo', args }); const value = await ctx.tools.call('echo', args); ctx.state.set('lastTool', 'echo'); ctx.emit({ type: 'state.snapshot', state: ctx.state.get() }); return value; };", "utf8");
    writeFileSync(join(cwd, "cases.ts"), "export default [{ id: 'echo', input: 'alpha', assertions: [{ type: 'tool.called', name: 'echo' }, { type: 'tool.args', name: 'echo', contains: { q: 'alpha' } }, { type: 'state.has', key: 'lastTool' }] }];", "utf8");
    writeFileSync(join(cwd, "canary.config.ts"), `export default { agent: { adapter: 'function', entry: './agent.mjs' }, cases: './cases.ts', tools: { adapter: 'mock', entry: './tools.mjs', export: 'demoTools' }, coverage: { include: ['agent.mjs', 'tools.mjs'] }, web: { host: '127.0.0.1', open: false } };`, "utf8");
    const result = await runCommandDetailed({ cwd, headless: true, noOpen: true });
    expect(result.exitCode).toBe(0);
    const artifact = JSON.parse(readFileSync(result.artifactPath, "utf8"));
    expect(artifact.results[0].output).toEqual({ echoed: { q: "alpha" } });
    expect(artifact.results[0].stateDiff.after.lastTool).toBe("echo");
  });

  it("runs MCP stdio tools through the runner tool chain", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-mcp-tools-"));
    const script = "process.stdin.setEncoding('utf8'); let b=''; process.stdin.on('data',c=>{b+=c; const i=b.indexOf('\\n'); if(i>=0){ const m=JSON.parse(b.slice(0,i)); process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{ok:m.params.name,args:m.params.arguments}})+'\\n'); }});";
    writeFileSync(join(cwd, "agent.mjs"), "export default async (input, ctx) => { const args = { q: input }; ctx.emit({ type: 'tool.call', name: 'lookup', args }); return ctx.tools.call('lookup', args); };", "utf8");
    writeFileSync(join(cwd, "cases.ts"), "export default [{ id: 'mcp', input: 'alpha', assertions: [{ type: 'tool.called', name: 'lookup' }, { type: 'output.exists' }] }];", "utf8");
    writeFileSync(join(cwd, "canary.config.ts"), `export default { agent: { adapter: 'function', entry: './agent.mjs' }, cases: './cases.ts', tools: { adapter: 'mcp-stdio', command: ${JSON.stringify(process.execPath)}, args: ['-e', ${JSON.stringify(script)}] }, coverage: { include: ['agent.mjs'] }, web: { host: '127.0.0.1', open: false } };`, "utf8");
    const result = await runCommandDetailed({ cwd, headless: true, noOpen: true });
    expect(result.exitCode).toBe(0);
    const artifact = JSON.parse(readFileSync(result.artifactPath, "utf8"));
    expect(artifact.results[0].output).toEqual({ ok: "lookup", args: { q: "alpha" } });
  });

  it("runs MCP HTTP JSON-RPC tools (not full Streamable HTTP)", async () => {
    const { createServer } = await import("node:http");
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { via: "http" } }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = typeof server.address() === "object" && server.address() ? server.address()!.port : 0;
    const cwd = mkdtempSync(join(tmpdir(), "canary-mcp-http-"));
    writeFileSync(join(cwd, "agent.mjs"), "export default async (input, ctx) => { const args = { q: input }; ctx.emit({ type: 'tool.call', name: 'lookup', args }); return ctx.tools.call('lookup', args); };", "utf8");
    writeFileSync(join(cwd, "cases.ts"), "export default [{ id: 'mcp-http', input: 'alpha', assertions: [{ type: 'tool.called', name: 'lookup' }] }];", "utf8");
    writeFileSync(join(cwd, "canary.config.ts"), `export default { agent: { adapter: 'function', entry: './agent.mjs' }, cases: './cases.ts', tools: { adapter: 'mcp-http', url: 'http://127.0.0.1:${port}/mcp' }, coverage: { include: ['agent.mjs'] }, web: { host: '127.0.0.1', open: false } };`, "utf8");
    try {
      const result = await runCommandDetailed({ cwd, headless: true, noOpen: true });
      expect(result.exitCode).toBe(0);
      const artifact = JSON.parse(readFileSync(result.artifactPath, "utf8"));
      expect(artifact.results[0].output).toEqual({ via: "http" });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("runs an HTTP black-box agent with unavailable coverage", async () => {
    const { createServer } = await import("node:http");
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ output: JSON.parse(body || "{}").input, remote: true }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = typeof server.address() === "object" && server.address() ? server.address()!.port : 0;
    const cwd = mkdtempSync(join(tmpdir(), "canary-http-demo-"));
    writeFileSync(join(cwd, "cases.ts"), "export default [{ id: 'http-echo', input: { goal: 'remote-task' }, assertions: [{ type: 'output.exists' }, { type: 'trajectory.required_event', event: 'http.request' }] }];", "utf8");
    writeFileSync(join(cwd, "canary.config.ts"), `export default { agent: { adapter: 'http', entry: 'http://127.0.0.1:${port}/agent' }, cases: './cases.ts', coverage: { include: ['cases.ts'] }, web: { host: '127.0.0.1', open: false } };`, "utf8");
    try {
      const result = await runCommandDetailed({ cwd, headless: true, noOpen: true });
      expect(result.exitCode).toBe(0);
      const artifact = JSON.parse(readFileSync(result.artifactPath, "utf8"));
      expect(artifact.results[0].coverage.status).toBe("unavailable");
      expect(artifact.coverage.status).toBe("unavailable");
      expect(artifact.results[0].output.remote).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("runs cases on a concurrent process pool", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-pool-"));
    writeFileSync(join(cwd, "agent.mjs"), "export default async (input) => { const t = Date.now(); await new Promise((resolve) => setTimeout(resolve, 80)); return { value: input, t, done: Date.now() }; };", "utf8");
    writeFileSync(join(cwd, "cases.ts"), "export default [{ id: 'a', input: 'one', assertions: [{ type: 'output.exists' }] }, { id: 'b', input: 'two', assertions: [{ type: 'output.exists' }] }];", "utf8");
    writeFileSync(join(cwd, "canary.config.ts"), `export default { agent: { adapter: 'function', entry: './agent.mjs' }, cases: './cases.ts', coverage: { include: ['agent.mjs'] }, runtime: { concurrency: 2 }, web: { host: '127.0.0.1', open: false } };`, "utf8");
    const result = await runCommandDetailed({ cwd, headless: true, noOpen: true });
    expect(result.exitCode).toBe(0);
    const artifact = JSON.parse(readFileSync(result.artifactPath, "utf8"));
    expect(artifact.results).toHaveLength(2);
    expect(artifact.passedCases).toBe(2);
    const starts = artifact.results.map((item: { output: { t: number } }) => item.output.t);
    const ends = artifact.results.map((item: { output: { done: number } }) => item.output.done);
    expect(Math.min(...ends) - Math.max(...starts)).toBeGreaterThan(20);
  });
});
