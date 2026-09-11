import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { CanaryConfig, CoverageSummary, EvalResult, Trajectory, TrajectoryEvent } from "@canary/core";
import { V8CoverageCollector } from "@canary/coverage";

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
  coverage: Omit<Parameters<typeof V8CoverageCollector>[0], "runId" | "executionId">;
  onEvent?: (event: RunnerEvent) => void;
  onCoverage?: (summary: CoverageSummary) => void;
}

export type RunnerEvent =
  | { type: "execution.started"; runId: string; executionId: string; caseId: string }
  | { type: "trace.event"; executionId: string; event: TrajectoryEvent }
  | { type: "execution.finished"; executionId: string; result: EvalResult }
  | { type: "execution.failed"; executionId: string; error: string };

interface ChildMessage {
  type: "ready" | "event" | "result" | "error";
  event?: TrajectoryEvent;
  value?: unknown;
  error?: string;
}

function workerSource(): string {
  return `
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  try {
    const mod = await import(workerData.entry);
    const fn = mod[workerData.exportName || 'default'];
    if (typeof fn !== 'function') throw new Error('Agent export is not a function: ' + (workerData.exportName || 'default'));
    const emit = (event) => parentPort.postMessage({ type: 'event', event: { ...event, timestamp: new Date().toISOString() } });
    parentPort.postMessage({ type: 'ready' });
    const value = await fn(workerData.input, { executionId: workerData.executionId, emit });
    parentPort.postMessage({ type: 'result', value });
  } catch (error) {
    parentPort.postMessage({ type: 'error', error: error instanceof Error ? error.stack || error.message : String(error) });
    process.exitCode = 1;
  }
})();
`;
}

function childScript(): string {
  return `
const { Worker } = require('node:worker_threads');
const worker = new Worker(${JSON.stringify(workerSource())}, { eval: true, workerData: JSON.parse(process.env.CANARY_WORKER_DATA) });
worker.on('message', message => process.send?.(message));
worker.on('error', error => process.send?.({ type: 'error', error: error.stack || error.message }));
worker.on('exit', code => { if (code !== 0) process.send?.({ type: 'error', error: 'worker exited with code ' + code }); process.exitCode = code; });
`;
}

function spawnExecution(options: ExecutionOptions): ChildProcess {
  const workerData = JSON.stringify({
    entry: new URL(resolve(options.cwd ?? process.cwd(), options.entry), "file://").href,
    exportName: options.exportName,
    input: options.input,
    executionId: options.caseId,
  });
  return spawn(options.nodeExecutable ?? process.execPath, ["-e", childScript()], {
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, CANARY_WORKER_DATA: workerData },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
}

export async function runExecution(options: ExecutionOptions): Promise<EvalResult> {
  const executionId = `exec_${randomUUID()}`;
  const startedAt = Date.now();
  const events: TrajectoryEvent[] = [];
  const child = spawnExecution({ ...options, caseId: executionId });
  options.onEvent?.({ type: "execution.started", runId: options.runId, executionId, caseId: options.caseId });
  const collector = new V8CoverageCollector({ ...options.coverage, runId: options.runId, executionId, onUpdate: options.onCoverage });
  await collector.start();
  let settled = false;
  let value: unknown;
  let failure: string | undefined;
  const timeout = setTimeout(() => {
    failure = `Execution timed out after ${options.timeoutMs ?? 60_000}ms`;
    child.kill("SIGTERM");
  }, options.timeoutMs ?? 60_000);
  await new Promise<void>((resolvePromise) => {
    child.on("message", (message: ChildMessage) => {
      if (message.type === "event" && message.event) {
        events.push(message.event);
        options.onEvent?.({ type: "trace.event", executionId, event: message.event });
      } else if (message.type === "result") {
        value = message.value;
        settled = true;
      } else if (message.type === "error") {
        failure = message.error ?? "Unknown execution error";
      }
    });
    child.on("error", (error) => { failure = error.stack ?? error.message; resolvePromise(); });
    child.on("exit", () => resolvePromise());
  });
  clearTimeout(timeout);
  if (failure && !settled) options.onEvent?.({ type: "execution.failed", executionId, error: failure });
  const coverage = await collector.stop();
  const trajectory: Trajectory = {
    id: `trajectory_${executionId}`,
    runId: options.runId,
    caseId: options.caseId,
    events,
    stepCount: events.filter((event) => event.type === "tool_call").length,
    termination: failure ? (failure.includes("timed out") ? "timeout" : "error") : "completed",
  };
  const result: EvalResult = {
    runId: options.runId,
    executionId,
    caseId: options.caseId,
    passed: !failure,
    assertions: [{ id: "agent.completed", passed: !failure, message: failure ?? "Agent completed" }],
    coverage,
    metrics: { latencyMs: Date.now() - startedAt, steps: trajectory.stepCount, toolCalls: trajectory.stepCount },
    failureCategory: failure ? (failure.includes("timed out") ? "timeout" : "runtime_error") : undefined,
    trajectoryId: trajectory.id,
    createdAt: new Date().toISOString(),
  };
  options.onEvent?.({ type: "execution.finished", executionId, result });
  return result;
}

export interface RunOptions { config: CanaryConfig; cwd?: string; headless?: boolean; onEvent?: (event: RunnerEvent) => void; onCoverage?: (summary: CoverageSummary) => void }
export async function runConfiguredCase(options: RunOptions, testCase: { id: string; input: unknown }): Promise<EvalResult> {
  return runExecution({
    cwd: options.cwd,
    entry: options.config.agent.entry,
    exportName: options.config.agent.export,
    input: testCase.input,
    runId: `run_${Date.now()}`,
    caseId: testCase.id,
    timeoutMs: 60_000,
    coverage: { include: options.config.coverage.include, exclude: options.config.coverage.exclude, rootDir: options.cwd },
    onEvent: options.onEvent,
    onCoverage: options.onCoverage,
  });
}
