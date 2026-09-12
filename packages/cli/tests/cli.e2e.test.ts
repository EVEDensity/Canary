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
