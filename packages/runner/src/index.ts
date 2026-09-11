import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
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
const { Worker } = require("node:worker_threads");
const { Session } = require("node:inspector/promises");

(async () => {
  const payload = JSON.parse(process.env.CANARY_WORKER_DATA);
  const session = new Session();
  let coverageStarted = false;
  let scripts = [];
  let workerError;
  try {
    await session.connect();
    await session.post("Profiler.enable");
    await session.post("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
    coverageStarted = true;
    const workerSource = String.raw\`
      const { parentPort, workerData } = require("node:worker_threads");
      (async () => {
        try {
          const mod = await import(workerData.entry);
          const agent = mod[workerData.exportName || "default"];
          if (typeof agent !== "function") throw new Error("Agent export is not a function: " + (workerData.exportName || "default"));
          const emit = (event) => parentPort.postMessage({ type: "event", event: { ...event, timestamp: new Date().toISOString() } });
          parentPort.postMessage({ type: "ready" });
          const value = await agent(workerData.input, { executionId: workerData.executionId, emit });
          parentPort.postMessage({ type: "result", value });
        } catch (error) {
          parentPort.postMessage({ type: "error", error: error && (error.stack || error.message) || String(error) });
        }
      })();
    \`;
    const worker = new Worker(workerSource, { eval: true, workerData: payload });
    worker.on("message", (message) => process.send?.(message));
    worker.on("error", (error) => { workerError = error; process.send?.({ type: "error", error: error.stack || error.message }); });
    await new Promise((resolve) => worker.once("exit", resolve));
    try { scripts = (await session.post("Profiler.takePreciseCoverage")).result || []; } catch (error) { workerError = workerError || error; }
  } catch (error) {
    workerError = workerError || error;
    process.send?.({ type: "error", error: error && (error.stack || error.message) || String(error) });
  } finally {
    if (coverageStarted) {
      try { await session.post("Profiler.stopPreciseCoverage"); } catch {}
      try { await session.post("Profiler.disable"); } catch {}
    }
    try { await session.disconnect(); } catch {}
    process.send?.({ type: "coverage", scripts, partial: Boolean(workerError) && scripts.length === 0 });
  }
})();`;
}

function spawnExecution(options: ExecutionOptions, executionId: string): ChildProcess {
  const cwd = options.cwd ?? process.cwd();
  const workerData = JSON.stringify({
    entry: new URL(resolve(cwd, options.entry), "file:").href,
    exportName: options.exportName,
    input: options.input,
    executionId,
  });
  return spawn(options.nodeExecutable ?? process.execPath, ["-e", createChildScript()], {
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
  let exitCode: number | null = null;

  options.onEvent?.({ type: "execution.started", runId: options.runId, executionId, caseId: options.caseId });
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
    child.once("error", (error) => { failure ??= error.stack ?? error.message; done(); });
    child.once("close", (code) => { exitCode = code; if (code && !failure) failure = `Execution child exited with code ${code}`; done(); });
  });
  clearTimeout(timeout);

  const coverage = makeCoverage(options, scripts, coveragePartial || didTimeout);
  options.onCoverage?.(coverage);
  options.onEvent?.({ type: "coverage.updated", executionId, coverage });
  if (failure) options.onEvent?.({ type: "execution.failed", executionId, error: failure });

  const trajectory: Trajectory = {
    id: `trajectory_${executionId}`,
    runId: options.runId,
    caseId: options.caseId,
    events,
    stepCount: events.filter((event) => event.type === "tool_call").length,
    termination: didTimeout ? "timeout" : failure ? "error" : "completed",
  };
  const result: EvalResult = {
    runId: options.runId,
    executionId,
    caseId: options.caseId,
    passed: !failure && exitCode === 0,
    assertions: [{ id: "agent.completed", passed: !failure && exitCode === 0, message: failure ?? "Agent completed" }],
    coverage,
    metrics: { latencyMs: Date.now() - startedAt, steps: trajectory.stepCount, toolCalls: trajectory.stepCount },
    failureCategory: didTimeout ? "timeout" : failure ? "runtime_error" : undefined,
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
