import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, readFileSync, writeFileSync } from "node:fs";
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
    const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-cases-")));
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
    const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-cli-")));
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
    const invocation = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-invoke-run-")));
    const project = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-target-run-")));
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
    const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-cli-headless-")));
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
    const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-cli-disabled-web-")));
    writeFileSync(join(cwd, "agent.mjs"), "export default async (input) => ({ value: input });", "utf8");
    writeFileSync(join(cwd, "cases.ts"), "export default [{ id: 'smoke', input: 'ok' }];", "utf8");
    writeFileSync(join(cwd, "canary.config.ts"), `export default { agent: { adapter: 'function', entry: './agent.mjs' }, cases: './cases.ts', coverage: { include: ['agent.mjs'], exclude: [] }, web: { enabled: false, host: '127.0.0.1', port: 1, open: true } };`, "utf8");
    const result = await runCommandDetailed({ cwd, noOpen: true });
    expect(result.exitCode).toBe(0);
    expect(result.uiUrl).toBe("");
  });

  it("prints the UI address before cases finish so SSE is reachable mid-run", async () => {
    const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-cli-live-ui-")));
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
    const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-gate-")));
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
    const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-judge-missing-")));
    writeFileSync(join(cwd, "agent.mjs"), "export default async (input) => ({ value: input });", "utf8");
    writeFileSync(join(cwd, "cases.ts"), "export default [{ id: 'scored', input: 'ok', assertions: [{ type: 'judge.score', minScore: 0.5 }] }];", "utf8");
    writeFileSync(join(cwd, "canary.config.ts"), `export default { agent: { adapter: 'function', entry: './agent.mjs' }, cases: './cases.ts', coverage: { include: ['agent.mjs'], exclude: [] }, web: { host: '127.0.0.1', open: false } };`, "utf8");
    const result = await runCommandDetailed({ cwd, headless: true, noOpen: true });
    expect(result.exitCode).toBe(1);
    const artifact = JSON.parse(readFileSync(result.artifactPath, "utf8"));
    expect(artifact.results[0].assertions.some((item: { message?: string }) => item.message?.includes("Required Judge provider is missing"))).toBe(true);
  });
});

describe("improvement CLI loop", () => {
  it("exports regression drafts from a failed run and rejects a holdout regression on compare", async () => {
    const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-improve-")));
    writeFileSync(join(cwd, "agent.mjs"), "export default async (input) => input === 'x' ? null : { value: input };", "utf8");
    writeFileSync(join(cwd, "cases.ts"), "export default [{ id: 'safe', input: 'ok', assertions: [{ type: 'output.exists' }] }, { id: 'broken', input: 'x', assertions: [{ type: 'output.exists' }] }];", "utf8");
    writeFileSync(join(cwd, "canary.config.ts"), `export default { agent: { adapter: 'function', entry: './agent.mjs' }, cases: './cases.ts', coverage: { include: ['agent.mjs'], exclude: [] }, web: { host: '127.0.0.1', open: false } };`, "utf8");
    const failed = await runCommandDetailed({ cwd, headless: true, noOpen: true });
    expect(failed.exitCode).toBe(1);
    const previousCwd = process.env.INIT_CWD;
    process.env.INIT_CWD = cwd;
    try {
      const improveCode = await main(["improve", failed.runId, "--out", join(cwd, "cases/regression"), "--config", join(cwd, "canary.config.ts")]);
      expect(improveCode).toBe(0);
      expect(existsSync(join(cwd, "cases/regression", "broken.regression.ts"))).toBe(true);
      expect(readFileSync(join(cwd, "cases/regression", "broken.regression.ts"), "utf8")).toContain("broken.regression");
    } finally {
      process.env.INIT_CWD = previousCwd;
    }

    writeFileSync(join(cwd, "agent.mjs"), "export default async (input) => ({ value: input });", "utf8");
    writeFileSync(join(cwd, "cases.ts"), "export default [{ id: 'safe', input: 'ok', assertions: [{ type: 'output.exists' }] }, { id: 'holdout-planning', input: 'holdout', tags: ['holdout'], dataset: { split: 'holdout' }, assertions: [{ type: 'output.exists' }] }];", "utf8");
    const baseline = await runCommandDetailed({ cwd, headless: true, noOpen: true });
    expect(baseline.exitCode).toBe(0);
    writeFileSync(join(cwd, "agent.mjs"), "export default async (input) => String(input).includes('holdout') ? null : { value: input };", "utf8");
    const candidate = await runCommandDetailed({ cwd, headless: true, noOpen: true });
    expect(candidate.exitCode).toBe(1);
    process.env.INIT_CWD = cwd;
    try {
      const compareCode = await main(["compare", baseline.runId, candidate.runId, "--config", join(cwd, "canary.config.ts")]);
      expect(compareCode).toBe(1);
    } finally {
      process.env.INIT_CWD = previousCwd;
    }
  });

  it("accepts and verifies a suggestion then runs a one-click candidate pipeline", async () => {
    const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-candidate-")));
    writeFileSync(join(cwd, "broken.mjs"), "export default async (input) => input === 'broken' ? null : { value: input };", "utf8");
    writeFileSync(join(cwd, "fixed.mjs"), "export default async (input) => ({ value: input });", "utf8");
    writeFileSync(join(cwd, "cases.ts"), "export default [{ id: 'safe', input: 'ok', assertions: [{ type: 'output.exists' }] }, { id: 'broken', input: 'broken', assertions: [{ type: 'output.exists' }] }, { id: 'holdout-planning', input: 'holdout', tags: ['holdout'], dataset: { split: 'holdout' }, assertions: [{ type: 'output.exists' }] }];", "utf8");
    writeFileSync(join(cwd, "canary.config.ts"), `export default { agent: { adapter: 'function', entry: './broken.mjs' }, cases: './cases.ts', coverage: { include: ['broken.mjs', 'fixed.mjs'], exclude: [] }, web: { host: '127.0.0.1', open: false } };`, "utf8");
    const baseline = await runCommandDetailed({ cwd, headless: true, noOpen: true });
    expect(baseline.exitCode).toBe(1);
    const previousCwd = process.env.INIT_CWD;
    process.env.INIT_CWD = cwd;
    try {
      expect(await main(["improve", baseline.runId, "--out", join(cwd, "cases/drafts"), "--config", join(cwd, "canary.config.ts")])).toBe(0);
      const suggestions = JSON.parse(readFileSync(join(cwd, ".canary/artifacts", baseline.runId, "improvement.json"), "utf8")) as Array<{ id: string; kind: string; caseId: string }>;
      const target = suggestions.find((item) => item.caseId === "broken");
      expect(target?.kind).toBe("wrong_output");
      expect(await main(["suggest", baseline.runId, "--accept", target!.id, "--config", join(cwd, "canary.config.ts")])).toBe(0);
      expect(await main(["suggest", baseline.runId, "--verify", target!.id, "--out", join(cwd, "cases/regression"), "--config", join(cwd, "canary.config.ts")])).toBe(0);
      expect(existsSync(join(cwd, "cases/regression", "broken.regression.ts"))).toBe(true);
      expect(readFileSync(join(cwd, "cases/regression", "broken.regression.ts"), "utf8")).toContain("verified");
      const code = await main(["candidate", baseline.runId, "--entry", "./fixed.mjs", "--headless", "--no-open", "--config", join(cwd, "canary.config.ts")]);
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

  it("runs an approved experience trial with regression, holdout, activation and rollback gates", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-s04-") );
    const sourceFile = join(cwd, "agent.mjs");
    const source = "export default async (input, ctx) => ctx.experiences.length ? ({ value: input, experienceIds: ctx.experiences.map((item) => item.id) }) : (input === 'broken' ? null : { value: input });";
    writeFileSync(sourceFile, source, "utf8");
    writeFileSync(join(cwd, "cases.ts"), "export default [{ id: 'broken', input: 'broken', assertions: [{ type: 'output.exists' }] }, { id: 'holdout', input: 'holdout', tags: ['holdout'], dataset: { split: 'holdout', version: 's04-demo' }, assertions: [{ type: 'output.exists' }] }];", "utf8");
    const configPath = join(cwd, "canary.config.ts");
    writeFileSync(configPath, "export default { agent: { adapter: 'function', entry: './agent.mjs' }, cases: './cases.ts', coverage: { include: ['agent.mjs'], exclude: [] }, web: { enabled: false } };", "utf8");
    const sourceBefore = readFileSync(sourceFile, "utf8");
    const baseline = await runCommandDetailed({ cwd, configPath, headless: true, noOpen: true });
    expect(baseline.exitCode).toBe(1);
    const proposalPath = join(cwd, "experience.json");
    writeFileSync(proposalPath, JSON.stringify({ key: "s04-recovery", source: { kind: "human", ref: "s04-test" }, summary: "Use bounded advisory context to recover the known broken case.", content: "When the bounded context is present, return a normal value for the known broken input.", scope: { caseIds: ["broken"] } }), "utf8");
    const previousCwd = process.env.INIT_CWD;
    process.env.INIT_CWD = cwd;
    try {
      const logs = [];
      const originalLog = console.log;
      console.log = (...items) => logs.push(items.map(String).join(" "));
      let proposal;
      try { expect(await main(["experience", "propose", "--file", proposalPath, "--config", configPath])).toBe(0); proposal = JSON.parse(logs.pop()); } finally { console.log = originalLog; }
      const experienceId = proposal.record.id;
      expect(await main(["experience", "validate", experienceId, "--config", configPath])).toBe(0);
      const preparedLogs = [];
      console.log = (...items) => preparedLogs.push(items.map(String).join(" "));
      let prepared;
      try { expect(await main(["soft-trial", "prepare", baseline.runId, "--experience", experienceId, "--regression", "broken", "--holdout", "holdout", "--config", configPath])).toBe(0); prepared = JSON.parse(preparedLogs.pop()); } finally { console.log = originalLog; }
      const trialId = prepared.record.id;
      expect(prepared.record.authorization.status).toBe("not_approved");
      const rejectedBeforeApprovalLogs = [];
      console.log = (...items) => rejectedBeforeApprovalLogs.push(items.map(String).join(" "));
      try { expect(await main(["soft-trial", "run", trialId, "--config", configPath])).toBe(1); } finally { console.log = originalLog; }
      expect(JSON.parse(rejectedBeforeApprovalLogs[0]).errors[0]).toMatch(/approval/);
      const validateLogs = [];
      console.log = (...items) => validateLogs.push(items.map(String).join(" "));
      try { expect(await main(["soft-trial", "validate", trialId, "--config", configPath])).toBe(0); } finally { console.log = originalLog; }
      const validated = JSON.parse(validateLogs[0]);

      expect(validated.record.status).toBe("validated");
      expect(validated.record.validation.regressionCaseIds).toEqual(["broken"]);
      expect(validated.record.validation.holdoutCaseIds).toEqual(["holdout"]);
      const approvalLogs = [];
      console.log = (...items) => approvalLogs.push(items.map(String).join(" "));
      try { expect(await main(["soft-trial", "approve", trialId, "--actor", "human-reviewer", "--reason", "independent regression and holdout evidence reviewed", "--config", configPath])).toBe(0); } finally { console.log = originalLog; }
      expect(JSON.parse(approvalLogs[0]).record.authorization.status).toBe("approved");
      const runLogs = [];
      console.log = (...items) => runLogs.push(items.map(String).join(" "));
      try { expect(await main(["soft-trial", "run", trialId, "--config", configPath]), runLogs.join("\n")).toBe(0); } finally { console.log = originalLog; }
      const activated = JSON.parse(runLogs[0]);
      expect(activated.record.status).toBe("activated");
      expect(activated.loadedExperienceIds).toContain(experienceId);
      expect(activated.sourceUnchanged).toBe(true);
      expect(readFileSync(sourceFile, "utf8")).toBe(sourceBefore);
      const rollbackLogs = [];
      console.log = (...items) => rollbackLogs.push(items.map(String).join(" "));
      try { expect(await main(["soft-trial", "rollback", trialId, "--config", configPath])).toBe(0); } finally { console.log = originalLog; }
      const rolledBack = JSON.parse(rollbackLogs[0]);
      expect(rolledBack.record.status).toBe("rolled_back");
      expect(rolledBack.loaded).toEqual([]);
    } finally { process.env.INIT_CWD = previousCwd; }
  });

  it("rejects a negative experience candidate and never approves it", async () => {
    const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-s04-negative-")));
    writeFileSync(join(cwd, "agent.mjs"), "export default async (input, ctx) => ctx.experiences.length ? ({ value: input }) : (input === 'broken' ? null : { value: input });", "utf8");
    writeFileSync(join(cwd, "cases.ts"), "export default [{ id: 'broken', input: 'broken', assertions: [{ type: 'output.exists' }] }, { id: 'holdout', input: 'holdout', assertions: [{ type: 'output.exists' }] }];", "utf8");
    const configPath = join(cwd, "canary.config.ts");
    writeFileSync(configPath, "export default { agent: { adapter: 'function', entry: './agent.mjs' }, cases: './cases.ts', coverage: { include: ['agent.mjs'], exclude: [] }, web: { enabled: false } };", "utf8");
    const baseline = await runCommandDetailed({ cwd, configPath, headless: true, noOpen: true });
    expect(baseline.exitCode).toBe(1);
    const proposalPath = join(cwd, "experience.json");
    writeFileSync(proposalPath, JSON.stringify({ key: "s04-negative", source: { kind: "human", ref: "s04-negative" }, summary: "Mis-scoped candidate.", content: "This experience is intentionally scoped away from the broken case.", scope: { caseIds: ["holdout"] } }), "utf8");
    const previousCwd = process.env.INIT_CWD;
    process.env.INIT_CWD = cwd;
    try {
      const originalLog = console.log;
      const proposalLogs: string[] = [];
      console.log = (...items) => proposalLogs.push(items.map(String).join(" "));
      let proposal: { record: { id: string } };
      try { expect(await main(["experience", "propose", "--file", proposalPath, "--config", configPath])).toBe(0); proposal = JSON.parse(proposalLogs.pop()!); } finally { console.log = originalLog; }
      expect(await main(["experience", "validate", proposal.record.id, "--config", configPath])).toBe(0);
      const prepareLogs: string[] = [];
      console.log = (...items) => prepareLogs.push(items.map(String).join(" "));
      let prepared: { record: { id: string } };
      try { expect(await main(["soft-trial", "prepare", baseline.runId, "--experience", proposal.record.id, "--regression", "broken", "--holdout", "holdout", "--config", configPath])).toBe(0); prepared = JSON.parse(prepareLogs.pop()!); } finally { console.log = originalLog; }
      const trialId = prepared.record.id;
      const validationLogs: string[] = [];
      console.log = (...items) => validationLogs.push(items.map(String).join(" "));
      try { expect(await main(["soft-trial", "validate", trialId, "--config", configPath])).toBe(1); } finally { console.log = originalLog; }
      const rejected = JSON.parse(validationLogs[0]);
      expect(rejected.record.status).toBe("rejected");
      expect(rejected.record.validation.valid).toBe(false);
      expect(rejected.record.validation.reasons.join(" ")).toMatch(/improve|failed|regression/i);
      const approvalLogs: string[] = [];
      console.log = (...items) => approvalLogs.push(items.map(String).join(" "));
      try { expect(await main(["soft-trial", "approve", trialId, "--actor", "reviewer", "--reason", "negative candidate rejected", "--config", configPath])).toBe(1); } finally { console.log = originalLog; }
      expect(JSON.parse(approvalLogs[0]).record).toBeUndefined();
    } finally { process.env.INIT_CWD = previousCwd; }
  });

  it("does not activate a soft trial when required Judge evidence is missing", async () => {
    const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-s04-judge-")));
    writeFileSync(join(cwd, "agent.mjs"), "export default async (input) => ({ value: input });", "utf8");
    writeFileSync(join(cwd, "cases.ts"), "export default [{ id: 'broken', input: 'broken', assertions: [{ type: 'judge.score', minScore: 0.5 }] }, { id: 'holdout', input: 'holdout', assertions: [{ type: 'judge.score', minScore: 0.5 }] }];", "utf8");
    const configPath = join(cwd, "canary.config.ts");
    writeFileSync(configPath, "export default { agent: { adapter: 'function', entry: './agent.mjs' }, cases: './cases.ts', coverage: { include: ['agent.mjs'], exclude: [] }, web: { enabled: false } };", "utf8");
    const baseline = await runCommandDetailed({ cwd, configPath, headless: true, noOpen: true });
    expect(baseline.exitCode).toBe(1);
    const previousCwd = process.env.INIT_CWD;
    process.env.INIT_CWD = cwd;
    try {
      const store = new (await import("@canary/experience")).ExperienceStore(join(cwd, ".canary", "experiences"));
      const experience = store.propose({ key: "s04-judge", projectRoot: cwd, source: { kind: "human", ref: "s04-judge" }, summary: "Judge-gated candidate.", content: "Use the bounded experience for the broken case.", scope: { caseIds: ["broken"] } });
      store.transition(experience.id, "validated");
      const originalLog = console.log;
      const prepareLogs: string[] = [];
      console.log = (...items) => prepareLogs.push(items.map(String).join(" "));
      let prepared: { record: { id: string } };
      try { expect(await main(["soft-trial", "prepare", baseline.runId, "--experience", experience.id, "--regression", "broken", "--holdout", "holdout", "--config", configPath])).toBe(0); prepared = JSON.parse(prepareLogs.pop()!); } finally { console.log = originalLog; }
      const validationLogs: string[] = [];
      console.log = (...items) => validationLogs.push(items.map(String).join(" "));
      try { expect(await main(["soft-trial", "validate", prepared.record.id, "--config", configPath])).toBe(1); } finally { console.log = originalLog; }
      const rejected = JSON.parse(validationLogs[0]);
      expect(rejected.record.status).toBe("rejected");
      expect(rejected.record.validation.reasons.join(" ")).toMatch(/Judge|failed|improve/i);
      const pointer = store.activePointer(cwd);
      expect(pointer.entries).toEqual([]);
    } finally { process.env.INIT_CWD = previousCwd; }
  });
  it("fails the policy hard gate on unexpected violations even when output exists", async () => {
    const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-policy-")));
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
    const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-replay-")));
    writeFileSync(join(cwd, "agent.mjs"), "export default async (input) => ({ value: input });", "utf8");
    writeFileSync(join(cwd, "cases.ts"), "export default [{ id: 'smoke', input: 'ok', assertions: [{ type: 'output.exists' }] }];", "utf8");
    writeFileSync(join(cwd, "canary.config.ts"), `export default { agent: { adapter: 'function', entry: './agent.mjs' }, cases: './cases.ts', coverage: { include: ['agent.mjs'], exclude: [] }, web: { host: '127.0.0.1', open: false } };`, "utf8");
    const first = await runCommandDetailed({ cwd, headless: true, noOpen: true });
    expect(first.exitCode).toBe(0);
    const previousCwd = process.env.INIT_CWD;
    process.env.INIT_CWD = cwd;
    try {
      const code = await main(["replay", first.runId, "--headless", "--no-open", "--config", join(cwd, "canary.config.ts")]);
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
    const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-reps-")));
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
    const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-cancel-")));
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
    const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-cancel-live-")));
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
    const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-mock-tools-")));
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
    const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-mcp-tools-")));
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
    const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-mcp-http-")));
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
    const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-http-demo-")));
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
    const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-pool-")));
    writeFileSync(join(cwd, "agent.mjs"), "export default async (input) => { const t = Date.now(); await new Promise((resolve) => setTimeout(resolve, 120)); return { value: input, t, done: Date.now() }; };", "utf8");
    writeFileSync(join(cwd, "cases.ts"), "export default [{ id: 'a', input: 'one', assertions: [{ type: 'output.exists' }] }, { id: 'b', input: 'two', assertions: [{ type: 'output.exists' }] }];", "utf8");
    writeFileSync(join(cwd, "canary.config.ts"), `export default { agent: { adapter: 'function', entry: './agent.mjs' }, cases: './cases.ts', coverage: { include: ['agent.mjs'] }, runtime: { concurrency: 2 }, web: { host: '127.0.0.1', open: false } };`, "utf8");
    const result = await runCommandDetailed({ cwd, headless: true, noOpen: true });
    expect(result.exitCode).toBe(0);
    const artifact = JSON.parse(readFileSync(result.artifactPath, "utf8"));
    expect(artifact.results).toHaveLength(2);
    expect(artifact.passedCases).toBe(2);
  });

  it("emits bounded structured host output and records only an unapproved proposal", async () => {
    const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-host-protocol-")));
    const configPath = join(cwd, "canary.config.ts");
    writeFileSync(join(cwd, "agent.mjs"), "export default async (input, ctx) => { ctx.emit({ type: 'tool_call', name: 'echo', secret: 'trace-secret' }); return { value: input, secret: 'output-secret' }; };", "utf8");
    writeFileSync(join(cwd, "cases.ts"), "export default [{ id: 'visible-case', input: 'input-secret', assertions: [{ type: 'output.exists' }] }];", "utf8");
    writeFileSync(configPath, "export default { agent: { adapter: 'function', entry: './agent.mjs' }, cases: './cases.ts', coverage: { include: ['agent.mjs'], exclude: [] }, web: { enabled: false } };", "utf8");

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
    try {
      const exitCode = await main(["run", "--headless", "--no-open", "--json", "--config", configPath]);
      expect(exitCode).toBe(0);
    } finally {
      console.log = originalLog;
    }
    expect(logs).toHaveLength(1);
    const runOutput = JSON.parse(logs[0]!) as { kind: string; run: { runId: string; artifactPath: string }; references: { runId: string } };
    expect(runOutput.kind).toBe("canary.host.run");
    expect(runOutput.run.runId).toMatch(/^run_/);
    expect(runOutput.references.runId).toBe(runOutput.run.runId);
    expect(existsSync(runOutput.run.artifactPath)).toBe(true);

    logs.length = 0;
    console.log = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
    try {
      expect(await main(["host", "evidence", runOutput.run.runId, "--max-cases", "1", "--max-events", "1", "--config", configPath])).toBe(0);
    } finally {
      console.log = originalLog;
    }
    expect(logs).toHaveLength(1);
    const evidenceText = logs[0]!;
    const evidence = JSON.parse(evidenceText) as { kind: string; untrustedEvidence: boolean; cases: Array<{ reference: { caseId: string }; traceEventTypes: string[] }>; bounds: { rawInputIncluded: boolean; rawOutputIncluded: boolean; rawTraceIncluded: boolean } };
    expect(evidence.kind).toBe("canary.host.evidence");
    expect(evidence.untrustedEvidence).toBe(true);
    expect(evidence.cases).toHaveLength(1);
    expect(evidence.cases[0]?.reference.caseId).toBe("visible-case");
    expect(evidence.cases[0]?.traceEventTypes).toEqual(["tool_call"]);
    expect(evidence.bounds).toEqual({ maxCases: 1, maxEventsPerCase: 1, rawInputIncluded: false, rawOutputIncluded: false, rawTraceIncluded: false });
    expect(evidenceText).not.toContain("input-secret");
    expect(evidenceText).not.toContain("output-secret");
    expect(evidenceText).not.toContain("trace-secret");

    logs.length = 0;
    console.log = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
    try {
      expect(await main(["host", "evidence", runOutput.run.runId, "--max-cases", "33", "--config", configPath])).toBe(1);
    } finally {
      console.log = originalLog;
    }
    expect(JSON.parse(logs[0]!) as { error: string }).toMatchObject({ error: expect.stringMatching(/between 1 and 32/) });

    const proposalPath = join(cwd, "proposal.json");
    writeFileSync(proposalPath, JSON.stringify({
      v: 1,
      kind: "canary.host.proposal",
      runId: runOutput.run.runId,
      caseRefs: ["visible-case"],
      summary: "The evaluated case completed.",
      observations: [{ caseId: "visible-case", claim: "The bounded evidence contains a tool_call event." }],
      suggestedActions: ["Review the evidence before making any source change."],
      limitations: ["This proposal is not approval."],
    }), "utf8");
    logs.length = 0;
    console.log = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
    try {
      expect(await main(["host", "validate-proposal", runOutput.run.runId, "--file", proposalPath, "--config", configPath])).toBe(0);
    } finally {
      console.log = originalLog;
    }
    const validation = JSON.parse(logs[0]!) as { valid: boolean; status: string; approval: { status: string }; artifactPath: string };
    expect(validation).toMatchObject({ valid: true, status: "recorded_unapproved", approval: { status: "not_approved" } });
    expect(existsSync(validation.artifactPath)).toBe(true);
    expect(existsSync(join(cwd, "agent.mjs"))).toBe(true);

    writeFileSync(proposalPath, "{not-json", "utf8");
    logs.length = 0;
    console.log = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
    try {
      expect(await main(["host", "validate-proposal", runOutput.run.runId, "--file", proposalPath, "--config", configPath])).toBe(1);
    } finally {
      console.log = originalLog;
    }
    const rejected = JSON.parse(logs[0]!) as { valid: boolean; status: string; approval: { status: string }; errors: string[] };
    expect(rejected).toMatchObject({ valid: false, status: "rejected", approval: { status: "not_approved" } });
    expect(rejected.errors.join(" ")).toMatch(/not valid JSON/);
  });

});

describe("S-03 versioned experiences", () => {
  it("requires proposal validation and activation, injects only active context, and records references", async () => {
    const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-s03-cli-")));
    const sourceFile = join(cwd, "agent.mjs");
    const sourceBefore = "export default async (input, ctx) => ({ input, experienceIds: ctx.experiences.map((item) => item.id), experienceVersions: ctx.experiences.map((item) => item.version) });";
    writeFileSync(sourceFile, sourceBefore, "utf8");
    writeFileSync(join(cwd, "cases.ts"), "export default [{ id: 'experience-case', input: 'ok' }];", "utf8");
    const configPath = join(cwd, "canary.config.ts");
    writeFileSync(configPath, "export default { agent: { adapter: 'function', entry: './agent.mjs' }, cases: './cases.ts', coverage: { include: ['agent.mjs'], exclude: [] }, web: { enabled: false } };", "utf8");
    const proposalPath = join(cwd, "experience.json");
    writeFileSync(proposalPath, JSON.stringify({
      key: "deterministic-context",
      source: { kind: "human", ref: "s03-test" },
      summary: "Keep this case deterministic.",
      content: "Prefer deterministic assertions for this case.",
      scope: { caseIds: ["experience-case"] },
    }), "utf8");
    const invoke = async (args: string[]): Promise<Record<string, any>> => {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...items: unknown[]) => logs.push(items.map(String).join(" "));
      try { expect(await main([...args, "--config", configPath])).toBe(0); }
      finally { console.log = originalLog; }
      expect(logs).toHaveLength(1);
      return JSON.parse(logs[0]!) as Record<string, any>;
    };

    const proposed = await invoke(["experience", "propose", "--file", proposalPath]);
    expect(proposed.kind).toBe("canary.experience.proposal");
    expect(proposed.approval.status).toBe("not_approved");
    expect(proposed.record.status).toBe("proposed");
    const experienceId = proposed.record.id as string;

    const beforeActivation = await invoke(["experience", "load", "--case", "experience-case"]);
    expect(beforeActivation.loaded).toEqual([]);
    await invoke(["experience", "validate", experienceId]);
    const validated = await invoke(["experience", "list"]);
    expect(validated.records.find((record: any) => record.id === experienceId).status).toBe("validated");
    const stillNotActive = await invoke(["experience", "load", "--case", "experience-case"]);
    expect(stillNotActive.loaded).toEqual([]);

    await invoke(["experience", "activate", experienceId]);
    const loaded = await invoke(["experience", "load", "--case", "experience-case"]);
    expect(loaded.loaded).toHaveLength(1);
    expect(loaded.loaded[0]).toMatchObject({ id: experienceId, version: 1 });

    const sourceHashBeforeRun = readFileSync(sourceFile, "utf8");
    const run = await runCommandDetailed({ cwd, configPath, headless: true, noOpen: true });
    expect(run.exitCode).toBe(0);
    expect(readFileSync(sourceFile, "utf8")).toBe(sourceHashBeforeRun);
    expect(run.snapshot.experiences).toEqual([expect.objectContaining({ id: experienceId, version: 1, contentHash: proposed.record.contentHash })]);
    expect(run.snapshot.results[0]?.output).toMatchObject({ experienceIds: [experienceId], experienceVersions: [1] });
    const runJson = JSON.parse(readFileSync(run.artifactPath, "utf8")) as { experiences?: Array<{ id: string; version: number; contentHash: string }> };
    expect(runJson.experiences).toEqual([expect.objectContaining({ id: experienceId, version: 1, contentHash: proposed.record.contentHash })]);

    const rejectedPath = join(cwd, "rejected-experience.json");
    writeFileSync(rejectedPath, JSON.stringify({ key: "unsafe", summary: "api_key=secret", content: "safe", source: { kind: "human" } }), "utf8");
    const rejectedLogs: string[] = [];
    const originalLog = console.log;
    console.log = (...items: unknown[]) => rejectedLogs.push(items.map(String).join(" "));
    try { expect(await main(["experience", "propose", "--file", rejectedPath, "--config", configPath])).toBe(1); }
    finally { console.log = originalLog; }
    expect(JSON.parse(rejectedLogs[0]!) as { valid: boolean; errors: string[] }).toMatchObject({ valid: false, errors: [expect.stringMatching(/sensitive data/)] });

    await invoke(["experience", "expire", experienceId]);
    const expiredRun = await runCommandDetailed({ cwd, configPath, headless: true, noOpen: true });
    expect(expiredRun.exitCode).toBe(0);
    expect(expiredRun.snapshot.experiences ?? []).toEqual([]);
    expect(expiredRun.snapshot.results[0]?.output).toMatchObject({ experienceIds: [], experienceVersions: [] });

    await invoke(["experience", "clear"]);
    const cleared = await invoke(["experience", "load", "--case", "experience-case"]);
    expect(cleared.loaded).toEqual([]);
  });
});

describe("H-01 CLI isolation probe", () => {
  it("prints process boundaries and does not claim Node workers are an OS sandbox", async () => {
    const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-iso-cli-")));
    writeFileSync(join(cwd, "agent.mjs"), "export default async (input) => ({ value: input });", "utf8");
    writeFileSync(join(cwd, "cases.ts"), "export default [{ id: 'smoke', input: 'ok' }];", "utf8");
    writeFileSync(join(cwd, "canary.config.ts"), `export default { agent: { adapter: 'function', entry: './agent.mjs' }, cases: './cases.ts', coverage: { include: ['agent.mjs'] } };`, "utf8");
    const logs: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
    try {
      expect(await main(["isolation", "probe", "--config", join(cwd, "canary.config.ts")])).toBe(0);
    } finally {
      console.log = original;
    }
    const payload = JSON.parse(logs[0] ?? "{}") as { kind: string; boundary: { notASandbox: string[] }; capability: { userspace: boolean } };
    expect(payload.kind).toBe("canary.isolation.probe");
    expect(payload.capability.userspace).toBe(true);
    expect(payload.boundary.notASandbox.join(" ")).toMatch(/worktree|child_process/);
  });
});

describe("S-02 CLI MCP server", () => {
  it("prints the dual-era compatibility matrix without starting a session", async () => {
    const logs: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
    try {
      expect(await main(["mcp", "matrix"])).toBe(0);
    } finally {
      console.log = original;
    }
    const payload = JSON.parse(logs.join("\n")) as {
      kind: string;
      protocols: string[];
      sampling: boolean;
      sourceWrite: boolean;
      tools: string[];
    };
    expect(payload.kind).toBe("canary.mcp.matrix");
    expect(payload.protocols).toEqual(["2026-07-28", "2025-11-25"]);
    expect(payload.sampling).toBe(false);
    expect(payload.sourceWrite).toBe(false);
    expect(payload.tools).toEqual(["canary.run", "canary.evidence", "canary.structure", "canary.submit_proposal"]);
  });

  it("refuses mcp serve when no token is configured", async () => {
    const previous = process.env.CANARY_MCP_TOKEN;
    delete process.env.CANARY_MCP_TOKEN;
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
    try {
      expect(await main(["mcp", "serve"])).toBe(1);
    } finally {
      console.error = original;
      if (previous === undefined) delete process.env.CANARY_MCP_TOKEN;
      else process.env.CANARY_MCP_TOKEN = previous;
    }
    expect(errors.join(" ")).toMatch(/token/);
  });
});
