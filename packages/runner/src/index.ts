import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { CanaryConfig, CanaryModelConfig, CanaryToolsConfig, CoverageScript, CoverageSummary, EvalResult, FeatureDefinition, TestCase, Trajectory, TrajectoryEvent } from "@canary/core";
import { IPC_MAX_BYTES, IPC_PROTOCOL_VERSION, parseChildMessage } from "@canary/core";
import { assignFeatureCoverage, emptyCoverage, mergeV8Scripts, summarizeCoverage } from "@canary/coverage";
import type { FeatureEvent } from "@canary/coverage";
import type { CoverageSourceConfig } from "@canary/coverage";
import { evaluateAgent, attributeFailure } from "@canary/evaluators";
import { runHttpAgent, runMcpAgent } from "@canary/adapters";

export const DEFAULT_SAMPLE_INTERVAL_MS = 1000;
export const DEFAULT_KILL_GRACE_MS = 500;

export function killProcessTree(pid: number, signal: NodeJS.Signals = "SIGKILL"): void {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }
  try { process.kill(-pid, signal); }
  catch {
    try { process.kill(pid, signal); } catch { /* already exited */ }
  }
}

export interface ExecutionOptions {
  cwd?: string;
  timeoutMs?: number;
  maxSteps?: number;
  maxToolCalls?: number;
  maxBudget?: number;
  nodeExecutable?: string;
  entry: string;
  exportName?: string;
  input: unknown;
  runId: string;
  caseId: string;
  testCase?: TestCase;
  features?: FeatureDefinition[];
  coverage: CoverageSourceConfig;
  onEvent?: (event: RunnerEvent) => void;
  onCoverage?: (summary: CoverageSummary) => void;
  signal?: AbortSignal;
  repetition?: number;
  repetitionTotal?: number;
  tools?: CanaryToolsConfig;
  model?: CanaryModelConfig;
  initialState?: Record<string, unknown>;
  killGraceMs?: number;
}
export type RunnerEvent =
  | { type: "execution.started"; runId: string; executionId: string; caseId: string }
  | { type: "trace.event"; executionId: string; event: TrajectoryEvent }
  | { type: "coverage.updated"; executionId: string; coverage: CoverageSummary }
  | { type: "execution.finished"; executionId: string; result: EvalResult }
  | { type: "execution.failed"; executionId: string; error: string };
type ChildMessage =
  | { v: 1; type: "ready" }
  | { v: 1; type: "event"; event: TrajectoryEvent }
  | { v: 1; type: "result"; value: unknown }
  | { v: 1; type: "error"; error: string }
  | { v: 1; type: "coverage"; scripts: CoverageScript[]; partial?: boolean; provisional?: boolean; phase?: "init" | "task" | "final"; processId?: number; isolateId?: string; sequence?: number };

function createChildScript(): string {
  return String.raw`
const { Session } = require("node:inspector");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fileURLToPath, pathToFileURL } = require("node:url");
const proto = 1;
const send = (message) => new Promise((resolve) => {
  if (typeof process.send !== "function" || !process.connected) return resolve();
  const envelope = Object.assign({ v: proto }, message);
  let encoded = "";
  try { encoded = JSON.stringify(envelope); } catch { return resolve(); }
  const maxBytes = Number((JSON.parse(process.env.CANARY_WORKER_DATA || "{}")).ipcMaxBytes || 8388608);
  if (Buffer.byteLength(encoded) > maxBytes) {
    try { process.send({ v: proto, type: "error", error: "IPC payload exceeds maximum size" }, undefined, undefined, () => resolve()); } catch { resolve(); }
    return;
  }
  try { process.send(envelope, undefined, undefined, () => resolve()); } catch { resolve(); }
});
(async () => {
  const payload = JSON.parse(process.env.CANARY_WORKER_DATA || "{}");
  const useIstanbul = payload.coverageProvider === "istanbul";
  const session = new Session(); let coverageStarted = false; let scripts = []; let partial = false; let sampleTimer; let lastSampleAt = 0; let lastSampleKey = ""; let tools; let seq = 0; let coverageMod; let istanbulTmp;
  const minInterval = Number(payload.sampleMinIntervalMs || 200);
  const coverageMeta = () => ({ processId: process.pid, isolateId: String(process.pid), sequence: ++seq });
  const istanbulScripts = () => coverageMod ? coverageMod.istanbulToScripts(coverageMod.readIstanbulCoverage()) : [];
  const sample = async () => {
    const now = Date.now();
    if (now - lastSampleAt < minInterval) return;
    try {
      const next = useIstanbul ? istanbulScripts() : (coverageStarted ? ((await post("Profiler.takePreciseCoverage")).result || []) : []);
      if (!useIstanbul && !coverageStarted) return;
      const key = JSON.stringify(next.map((script) => ({ url: script.url, functions: script.functions })));
      if (key === lastSampleKey) return;
      lastSampleKey = key; lastSampleAt = now;
      await send(Object.assign({ type: "coverage", scripts: next, provisional: true, phase: "task" }, coverageMeta()));
    } catch {}
  };
  const keepAlive = setInterval(() => {}, 2_147_483_647);
  const post = (method, params) => new Promise((resolve, reject) => session.post(method, params || {}, (error, result) => error ? reject(error) : resolve(result)));
  try {
    if (!useIstanbul) {
      session.connect(); await post("Profiler.enable"); await post("Debugger.enable"); await post("Profiler.startPreciseCoverage", { callCount: true, detailed: true }); coverageStarted = true;
    } else if (payload.coverageUrl) {
      coverageMod = await import(payload.coverageUrl);
    }
    const emit = (event) => send({ type: "event", event: { ...event, timestamp: new Date().toISOString() } });
    if (payload.sampleIntervalMs > 0) sampleTimer = setInterval(sample, payload.sampleIntervalMs);
    globalThis[Symbol.for("canary.feature.emit")] = (event) => emit(event);
    const adapters = payload.adaptersUrl ? await import(payload.adaptersUrl) : undefined;
    const environment = payload.environmentUrl ? await import(payload.environmentUrl) : undefined;
    const state = environment ? new environment.MemoryStateStore(payload.initialState || {}) : undefined;
    const model = adapters ? adapters.createModelProvider((payload.model && payload.model.provider) || "deterministic", payload.model && payload.model.responses) : undefined;
    let toolConfig = payload.tools;
    if (toolConfig && toolConfig.adapter === "mock" && toolConfig.entry) {
      const toolMod = await import(toolConfig.entry);
      const exported = toolMod[toolConfig.export || "default"];
      toolConfig = Object.assign({}, toolConfig, { tools: exported && typeof exported === "object" ? exported : {} });
    }
    tools = toolConfig && adapters ? await adapters.createToolAdapter(toolConfig) : undefined;
    let entryUrl = payload.entry;
    if (useIstanbul && coverageMod) {
      const entryPath = fileURLToPath(payload.entry);
      const instrumented = coverageMod.instrumentIstanbul(fs.readFileSync(entryPath, "utf8"), entryPath);
      istanbulTmp = path.join(os.tmpdir(), "canary-istanbul-" + process.pid + path.extname(entryPath));
      fs.writeFileSync(istanbulTmp, instrumented.code);
      entryUrl = pathToFileURL(istanbulTmp).href;
    }
    const mod = await import(entryUrl); const agent = mod[payload.exportName || "default"];
    if (typeof agent !== "function") throw new Error("Agent export is not a function");
    // Module-load window: sample then let V8 reset counters before the agent task.
    if (useIstanbul) {
      await send(Object.assign({ type: "coverage", scripts: istanbulScripts(), phase: "init" }, coverageMeta()));
    } else if (coverageStarted) {
      try {
        const init = await post("Profiler.takePreciseCoverage");
        await send(Object.assign({ type: "coverage", scripts: init.result || [], phase: "init" }, coverageMeta()));
      } catch {}
    }
    await send({ type: "ready" }); const value = await agent(payload.input, { executionId: payload.executionId, emit, tools, state, model }); await send({ type: "result", value });
  } catch (error) { partial = true; await send({ type: "error", error: error && (error.stack || error.message) || String(error) }); }
  finally {
    if (tools) try { await tools.close(); } catch {}
    clearInterval(keepAlive);
    if (sampleTimer) clearInterval(sampleTimer);
    if (useIstanbul) {
      scripts = istanbulScripts();
    } else if (coverageStarted) {
      try {
        const response = await post("Profiler.takePreciseCoverage"); scripts = response.result || [];
        scripts = await Promise.all(scripts.map(async (script) => {
          try { const source = await post("Debugger.getScriptSource", { scriptId: script.scriptId }); return { ...script, source: source.scriptSource }; }
          catch { return script; }
        }));
      } catch { partial = true; }
      try { await post("Profiler.stopPreciseCoverage"); } catch { partial = true; }
      try { await post("Profiler.disable"); await post("Debugger.disable"); } catch { partial = true; }
    }
    if (istanbulTmp) try { fs.unlinkSync(istanbulTmp); } catch {}
    try { delete globalThis[Symbol.for("canary.feature.emit")]; if (!useIstanbul) session.disconnect(); } catch {}
    await send(Object.assign({ type: "coverage", scripts, partial, phase: "final" }, coverageMeta())); if (process.connected) process.disconnect();
  }
})().catch(async (error) => { await send({ type: "error", error: error && (error.stack || error.message) || String(error) }); if (process.connected) process.disconnect(); });`;
}
function resolveWorkspaceModule(packageDir: string): string {
  const runnerRoot = resolve(fileURLToPath(import.meta.url), "..", "..");
  const src = resolve(runnerRoot, "..", packageDir, "src", "index.ts");
  const dist = resolve(runnerRoot, "..", packageDir, "dist", "index.js");
  if (existsSync(src)) return pathToFileURL(src).href;
  if (existsSync(dist)) return pathToFileURL(dist).href;
  return pathToFileURL(createRequire(import.meta.url).resolve(`@canary/${packageDir}`)).href;
}

function resolveToolPayload(cwd: string, tools?: CanaryToolsConfig): CanaryToolsConfig | undefined {
  if (!tools) return undefined;
  const next: CanaryToolsConfig = { ...tools, args: tools.args ? [...tools.args] : undefined };
  if (next.command === "node") next.command = process.execPath;
  if (next.entry) next.entry = pathToFileURL(resolve(cwd, next.entry)).href;
  return next;
}

function spawnExecution(options: ExecutionOptions, executionId: string): ChildProcess {
  const cwd = options.cwd ?? process.cwd();
  const require = createRequire(import.meta.url);
  const tsxLoader = pathToFileURL(require.resolve("tsx")).href;
  const entry = pathToFileURL(resolve(cwd, options.entry)).href;
  return spawn(options.nodeExecutable ?? process.execPath, ["--enable-source-maps", "--import", tsxLoader, "-e", createChildScript()], {
    cwd,
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      CANARY_WORKER_DATA: JSON.stringify({
        entry,
        exportName: options.exportName,
        input: options.input,
        executionId,
        sampleIntervalMs: options.coverage.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS,
        sampleMinIntervalMs: options.coverage.sampleMinIntervalMs ?? 200,
        ipcMaxBytes: IPC_MAX_BYTES,
        ipcVersion: IPC_PROTOCOL_VERSION,
        coverageProvider: options.coverage.provider ?? "v8",
        coverageUrl: resolveWorkspaceModule("coverage"),
        adaptersUrl: resolveWorkspaceModule("adapters"),
        environmentUrl: resolveWorkspaceModule("environment"),
        tools: resolveToolPayload(cwd, options.tools),
        model: options.model,
        initialState: options.initialState ?? options.testCase?.environment?.state ?? {},
      }),
    },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
}
function makeCoverage(options: ExecutionOptions, scripts: CoverageScript[], partial: boolean, events: TrajectoryEvent[], initCaptured = false): CoverageSummary {
  if (!scripts.length) return { ...emptyCoverage(options.runId), lifecycle: { initCaptured, taskWindow: "reset-after-init" } };
  const base = summarizeCoverage(options.runId, scripts, { ...options.coverage, features: options.features });
  const featureEvents: FeatureEvent[] = [];
  for (const event of events) {
    if (event.type === "feature.enter") featureEvents.push({ featureId: String(event.featureId ?? ""), status: "entered", caseId: options.caseId });
    if (event.type === "feature.exit") featureEvents.push({ featureId: String(event.featureId ?? ""), status: event.status === "failed" ? "failed" : "completed", caseId: options.caseId });
  }
  const enriched = assignFeatureCoverage(base, options.features ?? [], featureEvents, options.testCase?.expectedFeatures ?? [], options.caseId, options.coverage.rootDir ?? options.cwd ?? process.cwd());
  return { ...enriched, status: partial ? "partial" : enriched.status, lifecycle: { initCaptured, taskWindow: "reset-after-init" } };
}
function budgetUsed(events: TrajectoryEvent[]): number {
  return events.reduce((total, event) => total + (typeof event.cost === "number" ? event.cost : typeof event.budgetUsed === "number" ? event.budgetUsed : 0), 0);
}

export async function runExecution(options: ExecutionOptions): Promise<EvalResult> {
  const executionId = `exec_${randomUUID()}`; const startedAt = Date.now(); const events: TrajectoryEvent[] = [];
  if (options.signal?.aborted) {
    options.onEvent?.({ type: "execution.started", runId: options.runId, executionId, caseId: options.caseId });
    const coverage = emptyCoverage(options.runId);
    options.onCoverage?.(coverage);
    options.onEvent?.({ type: "execution.failed", executionId, error: "Execution cancelled" });
    return finishEvaluation(options, executionId, startedAt, events, undefined, "Execution cancelled", coverage, "cancelled");
  }
  const child = spawnExecution(options, executionId); let settled = false; let failure: string | undefined; let output: unknown;
  let scripts: CoverageScript[] = []; let initScripts: CoverageScript[] = []; let coveragePartial = false; let didTimeout = false; let didCancel = false; let exitCode: number | null = null; let stderr = "";
  let lastProvisionalKey = ""; let lastProvisionalAt = 0;
  const sampleMinIntervalMs = options.coverage.sampleMinIntervalMs ?? 200;
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  let killTimer: NodeJS.Timeout | undefined;
  const stopChild = (): void => {
    if (!child.pid || child.exitCode !== null) return;
    try { child.kill("SIGTERM"); } catch { /* ignore */ }
    killTimer = setTimeout(() => { if (child.exitCode === null && child.pid) killProcessTree(child.pid, "SIGKILL"); }, killGraceMs);
  };
  options.onEvent?.({ type: "execution.started", runId: options.runId, executionId, caseId: options.caseId });
  child.stderr?.setEncoding("utf8"); child.stderr?.on("data", (chunk: string) => { stderr += chunk; });
  const cancel = (): void => { if (!settled) { didCancel = true; failure = "Execution cancelled"; stopChild(); } };
  options.signal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(() => { if (!settled) { didTimeout = true; failure = `Execution timed out after ${options.timeoutMs ?? 60_000}ms`; stopChild(); } }, options.timeoutMs ?? 60_000);
  await new Promise<void>((resolvePromise) => {
    const done = (): void => { if (!settled) { settled = true; resolvePromise(); } };
    child.on("message", (raw: unknown) => {
      let message: ChildMessage;
      try { message = parseChildMessage(raw) as ChildMessage; }
      catch (error) { failure ??= error instanceof Error ? error.message : String(error); return; }
      if (message.type === "event") { events.push(message.event); options.onEvent?.({ type: "trace.event", executionId, event: message.event }); }
      else if (message.type === "result") output = message.value;
      else if (message.type === "error") failure ??= message.error;
      else if (message.type === "coverage") {
        if (message.phase === "init") { initScripts = message.scripts; return; }
        // takePreciseCoverage resets after init; recombine so module-load hits stay in the reported set.
        scripts = mergeV8Scripts([initScripts, message.scripts]); coveragePartial = Boolean(message.partial);
        if (message.provisional) {
          const now = Date.now();
          const key = JSON.stringify(scripts.map((script) => ({ url: script.url, functions: script.functions })));
          if (key === lastProvisionalKey || now - lastProvisionalAt < sampleMinIntervalMs) return;
          lastProvisionalKey = key; lastProvisionalAt = now;
          const provisional = makeCoverage(options, scripts, false, events, initScripts.length > 0);
          options.onCoverage?.({ ...provisional, status: "provisional" });
          options.onEvent?.({ type: "coverage.updated", executionId, coverage: { ...provisional, status: "provisional" } });
        }
      }
    });
    child.once("error", (error: Error) => { failure ??= error.stack ?? error.message; done(); });
    child.once("close", (code: number | null) => { exitCode = code; if (code && !failure) failure = stderr.trim() ? `Execution child exited with code ${code}: ${stderr.trim()}` : `Execution child exited with code ${code}`; done(); });
  });
  if (killTimer) clearTimeout(killTimer);
  clearTimeout(timeout); options.signal?.removeEventListener("abort", cancel);
  const termination: Trajectory["termination"] = didTimeout ? "timeout" : didCancel ? "cancelled" : failure ? "error" : "completed";
  const coverage = makeCoverage(options, scripts, coveragePartial || didTimeout || didCancel, events, initScripts.length > 0);
  options.onCoverage?.(coverage); options.onEvent?.({ type: "coverage.updated", executionId, coverage });
  if (failure) options.onEvent?.({ type: "execution.failed", executionId, error: failure });
  return finishEvaluation(options, executionId, startedAt, events, output, failure, coverage, termination);
}

export interface RunOptions { config: CanaryConfig; cwd?: string; runId: string; onEvent?: (event: RunnerEvent) => void; onCoverage?: (summary: CoverageSummary) => void; manifest?: CoverageSourceConfig["manifest"]; signal?: AbortSignal; repetition?: number; repetitionTotal?: number }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function changedKeys(before: unknown, after: unknown): string[] {
  if (!isRecord(before) || !isRecord(after)) return before === after ? [] : ["(value)"];
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}
function stateDiffFor(testCase: TestCase, events: TrajectoryEvent[], output: unknown) {
  const snapshots = events.filter((event) => event.state !== undefined || event.type === "state" || event.type === "state.changed" || event.type === "state.snapshot");
  const first = snapshots[0];
  const last = snapshots.at(-1);
  const before = (first && "state" in first ? first.state : testCase.environment?.state) ?? { input: testCase.input };
  const after = last && "state" in last ? last.state : output;
  return { before, after, changed: changedKeys(before, after) };
}

async function finishEvaluation(options: ExecutionOptions, executionId: string, startedAt: number, events: TrajectoryEvent[], output: unknown, failure: string | undefined, coverage: CoverageSummary, termination: Trajectory["termination"]): Promise<EvalResult> {
  const trajectory: Trajectory = { id: `trajectory_${executionId}`, runId: options.runId, caseId: options.caseId, events, stepCount: events.filter((event) => event.type === "tool_call" || event.type === "tool.call").length, termination };
  const testCase: TestCase = options.testCase ?? { id: options.caseId, input: options.input, assertions: [] };
  const stateDiff = stateDiffFor(testCase, events, output);
  const evaluation = await evaluateAgent({ assertions: testCase.assertions ?? [], context: { testCase, output, trajectory, executionStatus: trajectory.termination, latencyMs: Date.now() - startedAt, toolCalls: trajectory.stepCount, budgetUsed: budgetUsed(events), expectedFeatures: testCase.expectedFeatures, featureStatuses: Object.fromEntries(coverage.featureChains.map((feature) => [feature.featureId, feature.status])), coverage, state: stateDiff.after } });
  const expectedTermination = (testCase.assertions ?? []).some((assertion) => assertion.type === "execution.termination" && "expected" in assertion && assertion.expected === trajectory.termination);
  const runtimePassed = !failure || expectedTermination;
  const passed = runtimePassed && evaluation.passed;
  const result: EvalResult = {
    runId: options.runId, executionId, caseId: options.caseId,
    ...(options.repetition ? { repetition: options.repetition, repetitionTotal: options.repetitionTotal } : {}),
    passed, assertions: [{ id: "agent.completed", passed: runtimePassed, message: failure ?? "Agent completed" }, ...evaluation.assertions], coverage, output, input: options.input,
    metrics: { latencyMs: Date.now() - startedAt, steps: trajectory.stepCount, toolCalls: trajectory.stepCount, budgetUsed: budgetUsed(events) },
    trajectoryId: trajectory.id, trajectory, stateDiff, createdAt: new Date().toISOString(),
  };
  if (!passed) result.failureCategory = attributeFailure(result).kind;
  options.onEvent?.({ type: "execution.finished", executionId, result });
  return result;
}

export async function runHttpExecution(options: ExecutionOptions): Promise<EvalResult> {
  const executionId = `exec_${randomUUID()}`; const startedAt = Date.now(); const events: TrajectoryEvent[] = [];
  options.onEvent?.({ type: "execution.started", runId: options.runId, executionId, caseId: options.caseId });
  const emit = (event: TrajectoryEvent) => { events.push(event); options.onEvent?.({ type: "trace.event", executionId, event }); };
  emit({ type: "http.request", timestamp: new Date().toISOString(), url: options.entry });
  let output: unknown; let failure: string | undefined;
  try { output = await runHttpAgent(options.entry, options.input, options.timeoutMs ?? 10_000); emit({ type: "http.response", timestamp: new Date().toISOString() }); }
  catch (error) { failure = error instanceof Error ? error.message : String(error); options.onEvent?.({ type: "execution.failed", executionId, error: failure }); }
  const coverage = emptyCoverage(options.runId);
  options.onCoverage?.(coverage);
  options.onEvent?.({ type: "coverage.updated", executionId, coverage });
  return finishEvaluation(options, executionId, startedAt, events, output, failure, coverage, failure ? "error" : "completed");
}

export async function runMcpExecution(options: ExecutionOptions): Promise<EvalResult> {
  const executionId = `exec_${randomUUID()}`; const startedAt = Date.now(); const events: TrajectoryEvent[] = [];
  options.onEvent?.({ type: "execution.started", runId: options.runId, executionId, caseId: options.caseId });
  const emit = (event: TrajectoryEvent) => { events.push(event); options.onEvent?.({ type: "trace.event", executionId, event }); };
  const cwd = options.cwd ?? process.cwd();
  const require = createRequire(import.meta.url);
  const tsxLoader = pathToFileURL(require.resolve("tsx")).href;
  const entry = resolve(cwd, options.entry);
  const isTypeScript = /\.[cm]?tsx?$/.test(extname(options.entry));
  const command = options.nodeExecutable ?? process.execPath;
  const args = isTypeScript ? ["--import", tsxLoader, entry] : [entry];
  emit({ type: "mcp.request", timestamp: new Date().toISOString(), command, entry });
  let output: unknown; let failure: string | undefined;
  try { output = await runMcpAgent(command, args, options.input, options.timeoutMs ?? 10_000); emit({ type: "mcp.response", timestamp: new Date().toISOString() }); }
  catch (error) { failure = error instanceof Error ? error.message : String(error); options.onEvent?.({ type: "execution.failed", executionId, error: failure }); }
  const coverage = emptyCoverage(options.runId);
  options.onCoverage?.(coverage);
  options.onEvent?.({ type: "coverage.updated", executionId, coverage });
  return finishEvaluation(options, executionId, startedAt, events, output, failure, coverage, failure ? "error" : "completed");
}

export async function mapLimit<T, R>(items: readonly T[], limit: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (!items.length) return [];
  const concurrency = Math.max(1, Math.min(limit, items.length));
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]!, index);
    }
  }));
  return results;
}

export async function runConfiguredCase(options: RunOptions, testCase: TestCase): Promise<EvalResult> {
  const shared: ExecutionOptions = {
    cwd: options.cwd,
    entry: options.config.agent.entry,
    exportName: options.config.agent.export,
    input: testCase.input,
    runId: options.runId,
    caseId: testCase.id,
    testCase,
    features: options.config.features,
    timeoutMs: testCase.options?.timeoutMs ?? options.config.runtime?.timeoutMs ?? 60_000,
    maxSteps: testCase.options?.maxSteps ?? options.config.runtime?.maxSteps,
    maxToolCalls: testCase.options?.maxToolCalls ?? options.config.runtime?.maxToolCalls,
    maxBudget: testCase.options?.maxBudget ?? options.config.runtime?.maxBudget,
    tools: options.config.tools,
    model: options.config.model,
    initialState: testCase.environment?.state,
    coverage: {
      include: options.config.coverage.include,
      exclude: options.config.coverage.exclude,
      rootDir: options.cwd,
      manifest: options.manifest,
      features: options.config.features,
      sampleIntervalMs: options.config.coverage.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS,
      provider: options.config.coverage.provider,
    },
    onEvent: options.onEvent,
    onCoverage: options.onCoverage,
    signal: options.signal,
    repetition: options.repetition,
    repetitionTotal: options.repetitionTotal,
  };
  if (options.config.agent.adapter === "http") return runHttpExecution(shared);
  if (options.config.agent.adapter === "mcp") return runMcpExecution(shared);
  return runExecution(shared);
}


