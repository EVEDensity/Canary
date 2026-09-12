import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { CanaryConfig, CoverageScript, CoverageSummary, EvalResult, FeatureDefinition, TestCase, Trajectory, TrajectoryEvent } from "@canary/core";
import { FeatureRegistry } from "@canary/core";
import { assignFeatureCoverage, emptyCoverage, summarizeCoverage } from "@canary/coverage";
import type { FeatureEvent } from "@canary/coverage";
import type { CoverageSourceConfig } from "@canary/coverage";
import { evaluateAgent } from "@canary/evaluators";

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
}
export type RunnerEvent =
  | { type: "execution.started"; runId: string; executionId: string; caseId: string }
  | { type: "trace.event"; executionId: string; event: TrajectoryEvent }
  | { type: "coverage.updated"; executionId: string; coverage: CoverageSummary }
  | { type: "execution.finished"; executionId: string; result: EvalResult }
  | { type: "execution.failed"; executionId: string; error: string };
type ChildMessage =
  | { type: "ready" }
  | { type: "event"; event: TrajectoryEvent }
  | { type: "result"; value: unknown }
  | { type: "error"; error: string }
  | { type: "coverage"; scripts: CoverageScript[]; partial?: boolean; provisional?: boolean };

function createChildScript(): string {
  return String.raw`
const { Session } = require("node:inspector");
const send = (message) => new Promise((resolve) => {
  if (typeof process.send !== "function" || !process.connected) return resolve();
  try { process.send(message, undefined, undefined, () => resolve()); } catch { resolve(); }
});
(async () => {
  const payload = JSON.parse(process.env.CANARY_WORKER_DATA || "{}");
  const session = new Session(); let coverageStarted = false; let scripts = []; let partial = false; let sampleTimer;
  const sample = async () => { if (!coverageStarted) return; try { const response = await post("Profiler.takePreciseCoverage"); await send({ type: "coverage", scripts: response.result || [], provisional: true }); } catch {} };
  const keepAlive = setInterval(() => {}, 2_147_483_647);
  const post = (method, params) => new Promise((resolve, reject) => session.post(method, params || {}, (error, result) => error ? reject(error) : resolve(result)));
  try {
    session.connect(); await post("Profiler.enable"); await post("Debugger.enable"); await post("Profiler.startPreciseCoverage", { callCount: true, detailed: true }); coverageStarted = true;
    const emit = (event) => send({ type: "event", event: { ...event, timestamp: new Date().toISOString() } });
    if (payload.sampleIntervalMs > 0) sampleTimer = setInterval(sample, payload.sampleIntervalMs);
    globalThis[Symbol.for("canary.feature.emit")] = (event) => emit(event);
    const mod = await import(payload.entry); const agent = mod[payload.exportName || "default"];
    if (typeof agent !== "function") throw new Error("Agent export is not a function");
    await send({ type: "ready" }); const value = await agent(payload.input, { executionId: payload.executionId, emit }); await send({ type: "result", value });
  } catch (error) { partial = true; await send({ type: "error", error: error && (error.stack || error.message) || String(error) }); }
  finally {
    clearInterval(keepAlive);
    if (sampleTimer) clearInterval(sampleTimer);
    if (coverageStarted) {
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
    try { delete globalThis[Symbol.for("canary.feature.emit")]; session.disconnect(); } catch {}
    await send({ type: "coverage", scripts, partial }); if (process.connected) process.disconnect();
  }
})().catch(async (error) => { await send({ type: "error", error: error && (error.stack || error.message) || String(error) }); if (process.connected) process.disconnect(); });`;
}
function spawnExecution(options: ExecutionOptions, executionId: string): ChildProcess {
  const cwd = options.cwd ?? process.cwd();
  const require = createRequire(import.meta.url);
  const tsxLoader = pathToFileURL(require.resolve("tsx")).href;
  const entry = pathToFileURL(resolve(cwd, options.entry)).href;
  const isTypeScript = /\.[cm]?tsx?$/.test(extname(options.entry));
  return spawn(options.nodeExecutable ?? process.execPath, ["--enable-source-maps", ...(isTypeScript ? ["--import", tsxLoader] : []), "-e", createChildScript()], {
    cwd,
    env: { ...process.env, CANARY_WORKER_DATA: JSON.stringify({ entry, exportName: options.exportName, input: options.input, executionId, sampleIntervalMs: options.coverage.sampleIntervalMs ?? 0 }) },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
}
function makeCoverage(options: ExecutionOptions, scripts: CoverageScript[], partial: boolean, events: TrajectoryEvent[]): CoverageSummary {
  if (!scripts.length) return emptyCoverage(options.runId);
  const base = summarizeCoverage(options.runId, scripts, { ...options.coverage, features: options.features });
  const featureEvents: FeatureEvent[] = [];
  for (const event of events) {
    if (event.type === "feature.enter") featureEvents.push({ featureId: String(event.featureId ?? ""), status: "entered", caseId: options.caseId });
    if (event.type === "feature.exit") featureEvents.push({ featureId: String(event.featureId ?? ""), status: event.status === "failed" ? "failed" : "completed", caseId: options.caseId });
  }
  const enriched = assignFeatureCoverage(base, options.features ?? [], featureEvents, options.testCase?.expectedFeatures ?? [], options.caseId, options.coverage.rootDir ?? options.cwd ?? process.cwd());
  return { ...enriched, status: partial ? "partial" : enriched.status };
}
function budgetUsed(events: TrajectoryEvent[]): number {
  return events.reduce((total, event) => total + (typeof event.cost === "number" ? event.cost : typeof event.budgetUsed === "number" ? event.budgetUsed : 0), 0);
}

export async function runExecution(options: ExecutionOptions): Promise<EvalResult> {
  const executionId = `exec_${randomUUID()}`; const startedAt = Date.now(); const events: TrajectoryEvent[] = [];
  const child = spawnExecution(options, executionId); let settled = false; let failure: string | undefined; let output: unknown;
  let scripts: CoverageScript[] = []; let coveragePartial = false; let didTimeout = false; let didCancel = false; let exitCode: number | null = null; let stderr = "";
  options.onEvent?.({ type: "execution.started", runId: options.runId, executionId, caseId: options.caseId });
  child.stderr?.setEncoding("utf8"); child.stderr?.on("data", (chunk: string) => { stderr += chunk; });
  const cancel = (): void => { if (!settled) { didCancel = true; failure = "Execution cancelled"; child.kill(); } };
  options.signal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(() => { if (!settled) { didTimeout = true; failure = `Execution timed out after ${options.timeoutMs ?? 60_000}ms`; child.kill(); } }, options.timeoutMs ?? 60_000);
  await new Promise<void>((resolvePromise) => {
    const done = (): void => { if (!settled) { settled = true; resolvePromise(); } };
    child.on("message", (message: ChildMessage) => {
      if (message.type === "event") { events.push(message.event); options.onEvent?.({ type: "trace.event", executionId, event: message.event }); }
      else if (message.type === "result") output = message.value;
      else if (message.type === "error") failure ??= message.error;
      else if (message.type === "coverage") { scripts = message.scripts; coveragePartial = Boolean(message.partial); if (message.provisional) { const provisional = makeCoverage(options, scripts, false, events); options.onCoverage?.({ ...provisional, status: "provisional" }); options.onEvent?.({ type: "coverage.updated", executionId, coverage: { ...provisional, status: "provisional" } }); } }
    });
    child.once("error", (error: Error) => { failure ??= error.stack ?? error.message; done(); });
    child.once("close", (code: number | null) => { exitCode = code; if (code && !failure) failure = stderr.trim() ? `Execution child exited with code ${code}: ${stderr.trim()}` : `Execution child exited with code ${code}`; done(); });
  });
  clearTimeout(timeout); options.signal?.removeEventListener("abort", cancel);
  const trajectory: Trajectory = { id: `trajectory_${executionId}`, runId: options.runId, caseId: options.caseId, events, stepCount: events.filter((event) => event.type === "tool_call").length, termination: didTimeout ? "timeout" : didCancel ? "cancelled" : failure ? "error" : "completed" };
  const coverage = makeCoverage(options, scripts, coveragePartial || didTimeout || didCancel, events);
  options.onCoverage?.(coverage); options.onEvent?.({ type: "coverage.updated", executionId, coverage });
  if (failure) options.onEvent?.({ type: "execution.failed", executionId, error: failure });
  const runtimePassed = !failure && exitCode === 0;
  const testCase: TestCase = options.testCase ?? { id: options.caseId, input: options.input, assertions: [] };
  const registry = new FeatureRegistry(options.features ?? []);
  const evaluation = await evaluateAgent({ assertions: testCase.assertions ?? [], context: { testCase, output, trajectory, executionStatus: trajectory.termination, latencyMs: Date.now() - startedAt, toolCalls: trajectory.stepCount, budgetUsed: budgetUsed(events), expectedFeatures: testCase.expectedFeatures, featureStatuses: Object.fromEntries(coverage.featureChains.map((feature) => [feature.featureId, feature.status])) } });
  const result: EvalResult = {
    runId: options.runId, executionId, caseId: options.caseId, passed: runtimePassed && evaluation.passed,
    assertions: [{ id: "agent.completed", passed: runtimePassed, message: failure ?? "Agent completed" }, ...evaluation.assertions], coverage, output,
    metrics: { latencyMs: Date.now() - startedAt, steps: trajectory.stepCount, toolCalls: trajectory.stepCount, budgetUsed: budgetUsed(events) },
    failureCategory: didTimeout ? "timeout" : didCancel ? "cancelled" : failure ? "runtime_error" : evaluation.passed ? undefined : "assertion_failed", trajectoryId: trajectory.id, createdAt: new Date().toISOString(),
  };
  options.onEvent?.({ type: "execution.finished", executionId, result }); return result;
}

export interface RunOptions { config: CanaryConfig; cwd?: string; runId: string; onEvent?: (event: RunnerEvent) => void; onCoverage?: (summary: CoverageSummary) => void; manifest?: CoverageSourceConfig["manifest"] }
export async function runConfiguredCase(options: RunOptions, testCase: TestCase): Promise<EvalResult> {
  return runExecution({ cwd: options.cwd, entry: options.config.agent.entry, exportName: options.config.agent.export, input: testCase.input, runId: options.runId, caseId: testCase.id, testCase, features: options.config.features, timeoutMs: testCase.options?.timeoutMs ?? options.config.runtime?.timeoutMs ?? 60_000, maxSteps: testCase.options?.maxSteps ?? options.config.runtime?.maxSteps, maxToolCalls: testCase.options?.maxToolCalls ?? options.config.runtime?.maxToolCalls, maxBudget: testCase.options?.maxBudget ?? options.config.runtime?.maxBudget, coverage: { include: options.config.coverage.include, exclude: options.config.coverage.exclude, rootDir: options.cwd, manifest: options.manifest, features: options.config.features }, onEvent: options.onEvent, onCoverage: options.onCoverage });
}


