import { afterEach, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type EvalResult, type RunSnapshot, snapshotSourceCase, qualityContentHash } from "@canary/core";
import {
  beginArtifacts,
  FileArtifactRepository,
  readQualityAssessment,
  recordQualityDecision,
  sealArtifacts,
  writePrivateJson,
} from "@canary/trace";
import { type RunnerPorts } from "@canary/runner";
import {
  controlledImprovementCommand,
  executeControlledImprovement,
  frozenImprovementCases,
  prepareControlledImprovement,
  type ImprovementPreparation,
} from "../src/controlled-improvement.js";
import { resolveProjectContext } from "../src/home.js";

const roots: string[] = [];

it("previews recovery without configuration imports and applies only exact approved interrupted state", async () => {
  const f = fixture(),
    session = prepareControlledImprovement(f.context, f.preparation);
  const file = join(f.context.artifactRoot, ".improvements", `${session.plan.id}.json`);
  const running = {
    ...session,
    revision: 1,
    attempts: [
      {
        index: 1,
        executionRequest: executionRequest(session.plan.contentHash),
        startedAt: new Date().toISOString(),
        state: "running",
        owner: { pid: 2_147_483_646, nonce: "12345678-1234-4234-8234-123456789012" },
      },
    ],
  };
  writeFileSync(file, JSON.stringify({ ...running, contentHash: qualityContentHash(running) }));
  // Recovery inspects the ledger even if executable configuration has changed or is unusable.
  writeFileSync(f.context.configFile, "throw new Error('configuration must not be imported');");
  const log = vi.spyOn(console, "log").mockImplementation(() => {}),
    before = readFileSync(file, "utf8");
  const args = ["recover", session.plan.id, "--project", f.root, "--config", f.context.configFile, "--json"];
  expect(await controlledImprovementCommand(args)).toBe(0);
  const preview = JSON.parse(log.mock.calls.at(-1)![0]);
  expect(preview).toMatchObject({ status: "ready", lockHash: "absent", executionGranted: false });
  expect(readFileSync(file, "utf8")).toBe(before);
  expect(
    await controlledImprovementCommand([
      ...args,
      "--apply",
      "--session-hash",
      preview.sessionHash,
      "--lock-hash",
      "absent",
      "--actor",
      "maintainer",
      "--reason",
      "Close interrupted fixture attempt",
    ]),
  ).toBe(0);
  expect(JSON.parse(log.mock.calls.at(-1)![0]).attempts[0].result).toMatchObject({
    code: "IMPROVEMENT_INTERRUPTED",
    observed: { cases: null, toolCalls: null },
  });
  expect(await controlledImprovementCommand([...args, "--apply"])).toBe(2);
});

it("honors a stricter configured managed-tool limit before invoking any tool", async () => {
  const f = fixture(),
    file = join(f.root, "canary.config.mjs");
  writeFileSync(file, readFileSync(file, "utf8").replace('"maxToolCalls":100', '"maxToolCalls":0'));
  const session = prepareControlledImprovement(f.context, f.preparation);
  const result = await executeControlledImprovement(
    f.context,
    session.plan.id,
    executionRequest(session.plan.contentHash),
  );
  expect(result.attempts[0]?.result).toMatchObject({
    status: "blocked",
    code: "IMPROVEMENT_TOOL_BUDGET",
    observed: { cases: 1, toolCalls: 0 },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    if (resolve(root).startsWith(resolve(tmpdir(), "canary-r30-cli-"))) rmSync(root, { recursive: true, force: true });
});
const metric = { covered: 0, total: 0, pct: 0 };
function coverage(runId: string): EvalResult["coverage"] {
  return {
    runId,
    sourceHash: "source",
    status: "unavailable",
    lines: metric,
    statements: metric,
    functions: metric,
    branches: metric,
    files: [],
    featureChains: [],
  };
}
function fixture(configExtra = "", repetitions = 3) {
  const root = mkdtempSync(join(tmpdir(), "canary-r30-cli-"));
  roots.push(root);
  writeFileSync(join(root, "package.json"), '{"name":"controlled-verification","type":"module","private":true}');
  const config = {
    agent: { adapter: "function", entry: "old.mjs" },
    cases: "current-cases.mjs",
    tools: { adapter: "mock", entry: "./tools.mjs" },
    coverage: { include: ["*.mjs"] },
    runtime: { timeoutMs: 5000, maxToolCalls: 100, repetitions: 900, concurrency: 50 },
  };
  writeFileSync(
    join(root, "canary.config.mjs"),
    `import {writeFileSync,readdirSync,readFileSync} from 'node:fs'; import {join} from 'node:path'; const root=${JSON.stringify(root)}; const records=join(root,'.canary','artifacts','.improvements'); const file=readdirSync(records).find(n=>n.endsWith('.json')); const session=JSON.parse(readFileSync(join(records,file),'utf8')); if(session.attempts.at(-1).state!=='running')throw Error('claim missing'); writeFileSync(join(root,'config-imported.txt'),'claimed'); ${configExtra} export default ${JSON.stringify(config)};`,
  );
  writeFileSync(join(root, "current-cases.mjs"), "throw Error('current cases must never be imported');");
  writeFileSync(join(root, "old.mjs"), "export default async()=>null;");
  writeFileSync(
    join(root, "candidate.mjs"),
    "export default async(input,ctx)=>{ctx.emit({type:'tool.call',name:input});return ctx.tools.call(input,{value:'ok'});};",
  );
  writeFileSync(
    join(root, "tools.mjs"),
    "export default {lookup:async()=>({answer:'ok'}),echo:async()=>({answer:'ok'})};",
  );
  const context = resolveProjectContext({ cwd: root, configPath: "canary.config.mjs" }),
    repository = new FileArtifactRepository(context.artifactRoot);
  mkdirSync(context.artifactRoot, { recursive: true });
  const runId = "run_controlled",
    results: EvalResult[] = [];
  for (const caseId of ["routing", "holdout"])
    for (let repetition = 1; repetition <= repetitions; repetition++)
      results.push({
        runId,
        executionId: `exec_${caseId}_${repetition}`,
        caseId,
        repetition,
        repetitionTotal: repetitions,
        passed: caseId === "holdout",
        failureCategory: caseId === "routing" ? "wrong_tool" : undefined,
        assertions: [{ id: "route-contract", passed: caseId === "holdout", message: "Recorded tool contract" }],
        coverage: coverage(runId),
        sourceCase: {
          id: caseId,
          input: caseId === "routing" ? "lookup" : "echo",
          assertions: [{ type: "tool.called", id: "route-contract", name: caseId === "routing" ? "lookup" : "echo" }],
        },
      });
  const run: RunSnapshot = {
    runId,
    status: "failed",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:01.000Z",
    totalCases: repetitions * 2,
    completedCases: repetitions * 2,
    passedCases: repetitions,
    results,
    events: [],
  };
  const dir = join(context.artifactRoot, runId);
  beginArtifacts(dir);
  writePrivateJson(join(dir, "run.json"), run);
  sealArtifacts(dir);
  const view = readQualityAssessment(repository, runId),
    option = view.report.options.find((o) => o.action === "repair-behavior")!;
  recordQualityDecision(repository, runId, {
    reportHash: view.report.contentHash,
    expectedRevision: 0,
    optionId: option.id,
    action: "select",
    actor: "maintainer",
    reason: "Verify the retained tool contract",
  });
  const preparation: ImprovementPreparation = {
    runId,
    optionId: option.id,
    reportHash: view.report.contentHash,
    expectedRevision: 1,
    entry: "candidate.mjs",
    allowedPaths: ["candidate.mjs", "tools.mjs"],
    regressionCaseIds: ["routing"],
    holdoutCaseIds: ["holdout"],
    maxRuns: 1,
    maxCases: repetitions * 2,
    maxDurationMs: 30000,
    maxToolCalls: 32,
  };
  return { root, context, repository, preparation, run };
}
function executionRequest(planHash: string) {
  return { planHash, actor: "maintainer", reason: "Run the frozen regression and holdout suite" };
}
function passingPorts(mutate?: () => void): RunnerPorts {
  return {
    executeCase: vi.fn(async (options, testCase) => {
      mutate?.();
      options.onEvent?.({
        type: "trace.event",
        executionId: `${testCase.id}_${options.repetition}`,
        event: { type: "canary.controlled.tool_call", timestamp: new Date().toISOString() },
      });
      return {
        runId: options.runId,
        executionId: `${testCase.id}_${options.repetition}`,
        caseId: testCase.id,
        repetition: options.repetition,
        repetitionTotal: options.repetitionTotal,
        passed: true,
        assertions: [
          { id: "agent.completed", passed: true },
          { id: "route-contract", passed: true },
        ],
        coverage: coverage(options.runId),
        sourceCase: snapshotSourceCase(testCase),
      };
    }),
  };
}
it("prepares without importing config/cases and performs one real sealed candidate evaluation with preserved repetitions", async () => {
  const f = fixture(),
    before = f.repository.verify(f.preparation.runId),
    session = prepareControlledImprovement(f.context, f.preparation);
  expect(existsSync(join(f.root, "config-imported.txt"))).toBe(false);
  expect(session.plan.scope).toMatchObject({ trials: 6, caseIds: ["routing", "holdout"] });
  const finished = await executeControlledImprovement(
      f.context,
      session.plan.id,
      executionRequest(session.plan.contentHash),
    ),
    result = finished.attempts[0]!.result!;
  expect(readFileSync(join(f.root, "config-imported.txt"), "utf8")).toBe("claimed");
  expect(result).toMatchObject({
    status: "completed",
    observed: { cases: 6, managedLiveModelCalls: 0, monetaryCost: null },
    benefit: { status: "observed-improvement", sample: { paired: 6 }, changes: { improved: 3, regressed: 0 } },
  });
  const candidate = f.repository.readRun(result.candidateRunId!)!;
  expect(candidate.results).toHaveLength(6);
  expect(candidate.results.every((r) => r.passed)).toBe(true);
  expect(candidate.evidence!.lineage).toMatchObject({
    candidateOf: f.preparation.runId,
    parentManifestHash: before.manifestHash,
  });
  expect(candidate.experiences).toEqual([]);
  expect(f.repository.verify(f.preparation.runId)).toEqual(before);
  await expect(
    executeControlledImprovement(f.context, session.plan.id, executionRequest(session.plan.contentHash)),
  ).rejects.toMatchObject({ code: "IMPROVEMENT_BUDGET" });
}, 30000);
it("rejects stale selections, missing holdout, unsafe candidate paths and unfrozen assertion kinds before executable imports", () => {
  const f = fixture();
  expect(() => prepareControlledImprovement(f.context, { ...f.preparation, expectedRevision: 0 })).toThrow(
    /selected option/,
  );
  expect(() => prepareControlledImprovement(f.context, { ...f.preparation, holdoutCaseIds: ["routing"] })).toThrow(
    /previously pass/,
  );
  expect(() => prepareControlledImprovement(f.context, { ...f.preparation, entry: "../outside.mjs" })).toThrow(
    /project-relative/,
  );
  for (const type of ["output.predicate", "output.schema", "judge.score", "unknown.future"]) {
    const baseline = structuredClone(f.run);
    baseline.results[0]!.sourceCase!.assertions = [{ type }];
    expect(() => frozenImprovementCases(baseline)).toThrow(/unsupported/);
  }
  expect(existsSync(join(f.root, "config-imported.txt"))).toBe(false);
});
it("detects candidate drift before importing config and records a charged stopped attempt", async () => {
  const f = fixture(),
    session = prepareControlledImprovement(f.context, f.preparation);
  writeFileSync(join(f.root, "candidate.mjs"), "export default async()=> 'changed';");
  const result = await executeControlledImprovement(
    f.context,
    session.plan.id,
    executionRequest(session.plan.contentHash),
  );
  expect(result.attempts[0]).toMatchObject({
    state: "finished",
    result: { status: "blocked", code: "IMPROVEMENT_SOURCE_DRIFT", observed: { cases: 0 } },
  });
  expect(existsSync(join(f.root, "config-imported.txt"))).toBe(false);
});
it("rejects remote configuration after the durable claim and never dispatches a case", async () => {
  const f = fixture(),
    file = join(f.root, "canary.config.mjs");
  writeFileSync(
    file,
    readFileSync(file, "utf8").replace('"adapter":"mock"', '"adapter":"mcp-http","url":"https://example.invalid"'),
  );
  const session = prepareControlledImprovement(f.context, f.preparation),
    ports = passingPorts(),
    result = await executeControlledImprovement(
      f.context,
      session.plan.id,
      executionRequest(session.plan.contentHash),
      { ports },
    );
  expect(result.attempts[0]!.result).toMatchObject({ status: "blocked", code: "IMPROVEMENT_CONFIG_UNSUPPORTED" });
  expect(ports.executeCase).not.toHaveBeenCalled();
  expect(existsSync(join(f.root, "config-imported.txt"))).toBe(true);
});
it("clamps per-case overrides to remaining aggregate tool/time budgets and stops later trials on observed overrun", async () => {
  const f = fixture(),
    session = prepareControlledImprovement(f.context, { ...f.preparation, maxToolCalls: 1 }),
    ports = passingPorts();
  const result = await executeControlledImprovement(
    f.context,
    session.plan.id,
    executionRequest(session.plan.contentHash),
    { ports },
  );
  expect(result.attempts[0]!.result).toMatchObject({ status: "blocked", observed: { cases: 2, toolCalls: 2 } });
  const calls = vi.mocked(ports.executeCase).mock.calls;
  expect(calls[0]![1].options).toMatchObject({ maxToolCalls: 1, repetitions: 3 });
  expect(calls[1]![1].options!.maxToolCalls).toBe(0);
  expect(calls.every((call) => call[1].options!.timeoutMs! <= 30000)).toBe(true);
});
it("retains the candidate evidence but blocks benefit after source mutation during execution", async () => {
  const f = fixture(),
    session = prepareControlledImprovement(f.context, f.preparation),
    ports = passingPorts(() =>
      writeFileSync(join(f.root, "old.mjs"), "export default async()=> 'changed while running';"),
    );
  const result = await executeControlledImprovement(
    f.context,
    session.plan.id,
    executionRequest(session.plan.contentHash),
    { ports },
  );
  expect(result.attempts[0]!.result).toMatchObject({ status: "blocked", code: "IMPROVEMENT_SOURCE_DRIFT" });
  expect(result.attempts[0]!.result!.candidateRunId).toBeTruthy();
  expect(result.attempts[0]!.result!.benefit).toBeUndefined();
});
it("requires explicit execution and returns the immutable plan through the CLI without importing modules", async () => {
  const f = fixture(),
    session = prepareControlledImprovement(f.context, f.preparation),
    log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  expect(
    await controlledImprovementCommand([
      "execute",
      session.plan.id,
      "--project",
      f.root,
      "--config",
      "canary.config.mjs",
      "--json",
    ]),
  ).toBe(2);
  expect(JSON.parse(log.mock.calls.at(-1)![0]).code).toBe("IMPROVEMENT_INPUT");
  expect(
    await controlledImprovementCommand([
      "show",
      session.plan.id,
      "--project",
      f.root,
      "--config",
      "canary.config.mjs",
      "--json",
    ]),
  ).toBe(0);
  expect(JSON.parse(log.mock.calls.at(-1)![0]).plan.contentHash).toBe(session.plan.contentHash);
  expect(existsSync(join(f.root, "config-imported.txt"))).toBe(false);
  expect(
    readdirSync(join(f.context.artifactRoot, ".improvements")).filter((name) => name.endsWith(".json")),
  ).toHaveLength(1);
});
it("terminates a config with a top-level busy loop and durably closes the charged attempt", async () => {
  const f = fixture("while(true){};"),
    session = prepareControlledImprovement(f.context, { ...f.preparation, maxDurationMs: 1000 });
  const started = Date.now(),
    result = await executeControlledImprovement(f.context, session.plan.id, executionRequest(session.plan.contentHash));
  expect(Date.now() - started).toBeLessThan(8000);
  expect(result.attempts[0]).toMatchObject({
    state: "finished",
    result: { status: "blocked", code: "IMPROVEMENT_BUDGET", observed: { cases: 0 } },
  });
}, 10000);
it("rejects a missing frozen tool entry without dispatching a candidate", async () => {
  const f = fixture(),
    session = prepareControlledImprovement(f.context, { ...f.preparation, allowedPaths: ["candidate.mjs"] }),
    ports = passingPorts();
  const result = await executeControlledImprovement(
    f.context,
    session.plan.id,
    executionRequest(session.plan.contentHash),
    { ports },
  );
  expect(result.attempts[0]!.result!.code).toBe("IMPROVEMENT_CONFIG_UNSUPPORTED");
  expect(ports.executeCase).not.toHaveBeenCalled();
});
it.each(["insufficient", "holdout-regression"])(
  "returns a nonzero CLI exit for %s even when the attempt finishes",
  async (mode) => {
    const f = fixture("", mode === "insufficient" ? 1 : 3);
    if (mode === "holdout-regression")
      writeFileSync(
        join(f.root, "candidate.mjs"),
        "export default async(input,ctx)=>{ctx.emit({type:'tool.call',name:'lookup'});return ctx.tools.call('lookup',{value:'ok'});};",
      );
    const session = prepareControlledImprovement(f.context, f.preparation),
      log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const code = await controlledImprovementCommand([
      "execute",
      session.plan.id,
      "--project",
      f.root,
      "--config",
      "canary.config.mjs",
      "--plan-hash",
      session.plan.contentHash,
      "--actor",
      "maintainer",
      "--reason",
      "Verify without weakening the frozen suite",
      "--execute",
      "--json",
    ]);
    const result = JSON.parse(log.mock.calls.at(-1)![0]).attempts[0].result;
    expect(code).toBe(1);
    expect(result).toMatchObject({
      status: "completed",
      code: "IMPROVEMENT_EVALUATED",
      benefit: { status: mode === "insufficient" ? "insufficient" : "observed-regression" },
    });
  },
  30000,
);
it("prevents managed tool invocations above the limit even when the Agent emits no instrumentation and catches denials", async () => {
  const f = fixture();
  writeFileSync(
    join(f.root, "candidate.mjs"),
    "export default async(input,ctx)=>{for(let i=0;i<100;i++){try{await ctx.tools.call('lookup',{})}catch{}}return 'done';};",
  );
  writeFileSync(
    join(f.root, "tools.mjs"),
    `import {appendFileSync} from 'node:fs'; export default {lookup:async()=>{appendFileSync(${JSON.stringify(join(f.root, "managed-invocations.txt"))},'called\\n'); return 'ok';}};`,
  );
  const session = prepareControlledImprovement(f.context, { ...f.preparation, maxToolCalls: 2 }),
    result = await executeControlledImprovement(f.context, session.plan.id, executionRequest(session.plan.contentHash));
  expect(result.attempts[0]!.result).toMatchObject({
    status: "blocked",
    code: "IMPROVEMENT_TOOL_BUDGET",
    observed: { cases: 1, toolCalls: 2 },
  });
  expect(readFileSync(join(f.root, "managed-invocations.txt"), "utf8").trim().split("\n")).toHaveLength(2);
}, 15000);
it.each(["wrong-tool", "no-tool"])(
  "does not verify voluntary lookup claims with %s managed evidence",
  async (mode) => {
    const f = fixture();
    writeFileSync(
      join(f.root, "candidate.mjs"),
      `export default async(input,ctx)=>{ctx.emit({type:'tool.call',name:input});${mode === "wrong-tool" ? "return ctx.tools.call('echo',{});" : "return 'claimed';"}};`,
    );
    const session = prepareControlledImprovement(f.context, f.preparation),
      result = await executeControlledImprovement(
        f.context,
        session.plan.id,
        executionRequest(session.plan.contentHash),
      );
    expect(result.attempts[0]!.result).toMatchObject({ status: "completed", code: "IMPROVEMENT_EVALUATED" });
    expect(result.attempts[0]!.result!.benefit!.status).not.toBe("observed-improvement");
    const candidate = f.repository.readRun(result.attempts[0]!.result!.candidateRunId!)!;
    expect(candidate.results.filter((r) => r.caseId === "routing").every((r) => !r.passed)).toBe(true);
  },
  30000,
);
it.each(["oversized", "cyclic"])(
  "blocks %s managed arguments before invoking an unmetered tool",
  async (mode) => {
    const f = fixture();
    writeFileSync(
      join(f.root, "candidate.mjs"),
      `export default async(input,ctx)=>{const args=${mode === "oversized" ? "{value:'x'.repeat(70000)}" : "{};args.self=args"};try{await ctx.tools.call('lookup',args)}catch{}return 'done';};`,
    );
    writeFileSync(
      join(f.root, "tools.mjs"),
      `import {appendFileSync} from 'node:fs'; export default {lookup:async()=>{appendFileSync(${JSON.stringify(join(f.root, "unmetered-invocations.txt"))},'called');return 'ok';}};`,
    );
    const session = prepareControlledImprovement(f.context, f.preparation),
      result = await executeControlledImprovement(
        f.context,
        session.plan.id,
        executionRequest(session.plan.contentHash),
      );
    expect(result.attempts[0]!.result).toMatchObject({
      status: "blocked",
      code: "IMPROVEMENT_TOOL_EVIDENCE",
      observed: { toolCalls: 0 },
    });
    expect(existsSync(join(f.root, "unmetered-invocations.txt"))).toBe(false);
  },
  15000,
);
