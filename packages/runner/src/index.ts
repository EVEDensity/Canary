import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { CanaryConfig, CoverageScript, CoverageSummary, EvalResult, Trajectory, TrajectoryEvent } from "@canary/core";
import { emptyCoverage, summarizeCoverage } from "@canary/coverage";
import type { CoverageSourceConfig } from "@canary/coverage";

export interface ExecutionOptions {
  cwd?: string;
  timeoutMs?: number;
  maxSteps?: number;
  nodeExecutable?: string;
  entry: string;
  exportName?: string;
  input: unknown;
  runId: string;
  caseId: string;
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
  | { type: "coverage"; scripts: CoverageScript[]; partial?: boolean };

function createChildScript(): string {
  return String.raw`
const { Session } = require("node:inspector");

const send = (message) => new Promise((resolve) => {
  if (typeof process.send !== "function" || !process.connected) return resolve();
  try { process.send(message, undefined, undefined, () => resolve()); } catch { resolve(); }
});

(async () => {
  const payload = JSON.parse(process.env.CANARY_WORKER_DATA || "{}");
  const session = new Session();
  let coverageStarted = false;
  let scripts = [];
  let partial = false;
  const keepAlive = setInterval(() => {}, 2_147_483_647);
  try {
    session.connect();
    const post = (method, params) => new Promise((resolve, reject) => {
      session.post(method, params || {}, (error, result) => error ? reject(error) : resolve(result));
    });
    await post("Profiler.enable");
    await post("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
    coverageStarted = true;

    const mod = await import(payload.entry);
    const agent = mod[payload.exportName || "default"];
    if (typeof agent !== "function") throw new Error("Agent export is not a function");
    const emit = (event) => send({ type: "event", event: { ...event, timestamp: new Date().toISOString() } });
    await send({ type: "ready" });
    const value = await agent(payload.input, { executionId: payload.executionId, emit });
    await send({ type: "result", value });
  } catch (error) {
    partial = true;
    await send({ type: "error", error: error && (error.stack || error.message) || String(error) });
  } finally {
    clearInterval(keepAlive);
    if (coverageStarted) {
      try {
        const response = await new Promise((resolve, reject) => {
          session.post("Profiler.takePreciseCoverage", {}, (error, result) => error ? reject(error) : resolve(result));
        });
        scripts = response.result || [];
      } catch { partial = true; }
      try { await new Promise((resolve) => session.post("Profiler.stopPreciseCoverage", {}, () => resolve())); } catch { partial = true; }
      try { await new Promise((resolve) => session.post("Profiler.disable", {}, () => resolve())); } catch { partial = true; }
    }
    try { session.disconnect(); } catch {}
    await send({ type: "coverage", scripts, partial });
    if (process.connected) process.disconnect();
  }
})().catch(async (error) => {
  await send({ type: "error", error: error && (error.stack || error.message) || String(error) });
  if (process.connected) process.disconnect();
});`;
}
function spawnExecution(options: ExecutionOptions, executionId: string): ChildProcess {
  const cwd = options.cwd ?? process.cwd();
  const workerData = JSON.stringify({
    entry: pathToFileURL(resolve(cwd, options.entry)).href,
    exportName: options.exportName,
    input: options.input,
    executionId,
  });
  const isTypeScriptEntry = [".ts", ".mts", ".cts", ".tsx"].includes(extname(options.entry));
  const args = ["-e", createChildScript()];
  if (isTypeScriptEntry) {
    const require = createRequire(import.meta.url);
    const tsxLoader = require.resolve("tsx");
    args.unshift("--import", pathToFileURL(tsxLoader).href);
  }
  return spawn(options.nodeExecutable ?? process.execPath, args, {
    cwd,
    env: { ...process.env, CANARY_WORKER_DATA: workerData },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
}

function makeCoverage(options: ExecutionOptions, scripts: CoverageScript[], partial: boolean): CoverageSummary {
  if (!scripts.length) return emptyCoverage(options.runId);
  const summary = summarizeCoverage(options.runId, scripts, options.coverage);
  return partial ? { ...summary, status: "partial" } : summary;
}

export async function runExecution(options: ExecutionOptions): Promise<EvalResult> {
  const executionId = `exec_${randomUUID()}`;
  const startedAt = Date.now();
  const events: TrajectoryEvent[] = [];
  const child = spawnExecution(options, executionId);
  let settled = false;
  let failure: string | undefined;
  let scripts: CoverageScript[] = [];
  let coveragePartial = false;
  let didTimeout = false;
  let didCancel = false;
  let exitCode: number | null = null;
  let stderr = "";

  options.onEvent?.({ type: "execution.started", runId: options.runId, executionId, caseId: options.caseId });
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => { stderr += chunk; });
  const cancel = (): void => {
    if (settled) return;
    didCancel = true;
    failure = "Execution cancelled";
    child.kill();
  };
  options.signal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(() => {
    if (settled) return;
    didTimeout = true;
    failure = `Execution timed out after ${options.timeoutMs ?? 60_000}ms`;
    child.kill();
  }, options.timeoutMs ?? 60_000);

  await new Promise<void>((resolvePromise) => {
    const done = (): void => { settled = true; resolvePromise(); };
    child.on("message", (message: ChildMessage) => {
      if (message.type === "event") {
        events.push(message.event);
        options.onEvent?.({ type: "trace.event", executionId, event: message.event });
      } else if (message.type === "error") {
        failure ??= message.error;
      } else if (message.type === "coverage") {
        scripts = message.scripts;
        coveragePartial = Boolean(message.partial);
      }
    });
    child.once("error", (error: Error) => { failure ??= error.stack ?? error.message; done(); });
    child.once("close", (code: number | null) => {
      exitCode = code;
      if (code && !failure) {
        const diagnostic = stderr.trim();
        failure = diagnostic ? `Execution child exited with code ${code}: ${diagnostic}` : `Execution child exited with code ${code}`;
      }
      done();
    });
  });
  clearTimeout(timeout);
  options.signal?.removeEventListener("abort", cancel);

  const coverage = makeCoverage(options, scripts, coveragePartial || didTimeout || didCancel);
  options.onCoverage?.(coverage);
  options.onEvent?.({ type: "coverage.updated", executionId, coverage });
  if (failure) options.onEvent?.({ type: "execution.failed", executionId, error: failure });

  const trajectory: Trajectory = {
    id: `trajectory_${executionId}`,
    runId: options.runId,
    caseId: options.caseId,
    events,
    stepCount: events.filter((event) => event.type === "tool_call").length,
    termination: didTimeout ? "timeout" : didCancel ? "cancelled" : failure ? "error" : "completed",
  };
  const result: EvalResult = {
    runId: options.runId,
    executionId,
    caseId: options.caseId,
    passed: !failure && exitCode === 0,
    assertions: [{ id: "agent.completed", passed: !failure && exitCode === 0, message: failure ?? "Agent completed" }],
    coverage,
    metrics: { latencyMs: Date.now() - startedAt, steps: trajectory.stepCount, toolCalls: trajectory.stepCount },
    failureCategory: didTimeout ? "timeout" : didCancel ? "cancelled" : failure ? "runtime_error" : undefined,
    trajectoryId: trajectory.id,
    createdAt: new Date().toISOString(),
  };
  options.onEvent?.({ type: "execution.finished", executionId, result });
  return result;
}

export interface RunOptions { config: CanaryConfig; cwd?: string; runId: string; onEvent?: (event: RunnerEvent) => void; onCoverage?: (summary: CoverageSummary) => void }
export async function runConfiguredCase(options: RunOptions, testCase: { id: string; input: unknown }): Promise<EvalResult> {
  return runExecution({
    cwd: options.cwd,
    entry: options.config.agent.entry,
    exportName: options.config.agent.export,
    input: testCase.input,
    runId: options.runId,
    caseId: testCase.id,
    timeoutMs: 60_000,
    coverage: { include: options.config.coverage.include, exclude: options.config.coverage.exclude, rootDir: options.cwd },
    onEvent: options.onEvent,
    onCoverage: options.onCoverage,
  });
}













