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
    expect(result.uiUrl).toBe("");
  });

  it("writes artifacts to the --config project, not the invocation directory", async () => {
    const invocation = mkdtempSync(join(tmpdir(), "canary-invoke-run-"));
    const project = mkdtempSync(join(tmpdir(), "canary-target-run-"));
    writeFileSync(join(project, "agent.mjs"), "export default async (input) => ({ value: input });", "utf8");
    writeFileSync(join(project, "cases.ts"), "export default [{ id: 'smoke', input: 'ok' }];", "utf8");
    writeFileSync(join(project, "canary.config.ts"), `export default { agent: { adapter: 'function', entry: './agent.mjs' }, cases: './cases.ts', coverage: { include: ['agent.mjs'], exclude: [] }, web: { host: '127.0.0.1', open: false } };`, "utf8");
    const result = await runCommandDetailed({ cwd: invocation, configPath: join(project, "canary.config.ts"), headless: true, noOpen: true });
    expect(result.exitCode).toBe(0);
    expect(result.artifactPath.startsWith(join(project, ".canary", "artifacts"))).toBe(true);
    expect(existsSync(join(invocation, ".canary"))).toBe(false);
    expect(listRunArtifacts(invocation, join(project, "canary.config.ts")).some((run) => run.runId === result.runId)).toBe(true);
  });

  it("does not bind a UI port in headless mode", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-cli-headless-"));
    writeFileSync(join(cwd, "agent.mjs"), "export default async (input) => ({ value: input });", "utf8");
    writeFileSync(join(cwd, "cases.ts"), "export default [{ id: 'smoke', input: 'ok' }];", "utf8");
    writeFileSync(join(cwd, "canary.config.ts"), `export default { agent: { adapter: 'function', entry: './agent.mjs' }, cases: './cases.ts', coverage: { include: ['agent.mjs'], exclude: [] }, web: { enabled: true, host: '127.0.0.1', port: 1, open: true } };`, "utf8");
    const logs: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
    try {
      const result = await runCommandDetailed({ cwd, headless: true, noOpen: true });
      expect(result.exitCode).toBe(0);
      expect(result.uiUrl).toBe("");
      expect(logs.some((line) => line.startsWith("runId: "))).toBe(true);
      expect(logs.some((line) => line.includes("canary UI:"))).toBe(false);
    } finally {
      console.log = original;
    }
  });

  it("honors web.enabled: false without --headless", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-cli-disabled-web-"));
    writeFileSync(join(cwd, "agent.mjs"), "export default async (input) => ({ value: input });", "utf8");
    writeFileSync(join(cwd, "cases.ts"), "export default [{ id: 'smoke', input: 'ok' }];", "utf8");
    writeFileSync(join(cwd, "canary.config.ts"), `export default { agent: { adapter: 'function', entry: './agent.mjs' }, cases: './cases.ts', coverage: { include: ['agent.mjs'], exclude: [] }, web: { enabled: false, host: '127.0.0.1', port: 1, open: true } };`, "utf8");
    const result = await runCommandDetailed({ cwd, noOpen: true });
    expect(result.exitCode).toBe(0);
    expect(result.uiUrl).toBe("");
  });

  it("prints the UI address before cases finish so SSE is reachable mid-run", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-cli-live-ui-"));
    writeFileSync(join(cwd, "agent.mjs"), "export default async (input) => { await new Promise((resolve) => setTimeout(resolve, 1200)); return { value: input }; };", "utf8");
    writeFileSync(join(cwd, "cases.ts"), "export default [{ id: 'slow', input: 'ok' }];", "utf8");
    writeFileSync(join(cwd, "canary.config.ts"), `export default { agent: { adapter: 'function', entry: './agent.mjs' }, cases: './cases.ts', coverage: { include: ['agent.mjs'], exclude: [] }, web: { host: '127.0.0.1', open: false } };`, "utf8");
    const logs: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
    const pending = runCommandDetailed({ cwd, noOpen: true });
    try {
      let uiLine = "";
      for (let i = 0; i < 80 && !uiLine; i += 1) {
        uiLine = logs.find((line) => line.includes("canary UI:")) ?? "";
        if (!uiLine) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(uiLine).toContain("canary UI:");
      const url = uiLine.replace(/^.*canary UI:\s*/, "").trim();
      const snapshot = await fetch(new URL("/api/runs", url).href);
      expect(snapshot.ok).toBe(true);
      const runs = await snapshot.json() as Array<{ status: string }>;
      expect(runs[0]?.status).toBe("running");
    } finally {
      console.log = original;
      const result = await pending;
      await result.close();
      expect(result.exitCode).toBe(0);
      expect(result.uiUrl).toContain("http://");
    }
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

  it("fails closed when judge.score is required and no provider is configured", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-judge-missing-"));
    writeFileSync(join(cwd, "agent.mjs"), "export default async (input) => ({ value: input });