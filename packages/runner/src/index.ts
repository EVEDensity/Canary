import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { CanaryConfig, CanaryModelConfig, CanaryToolsConfig, CoverageScript, CoverageSummary, EvalResult, FeatureDefinition, LoadedExperience, RunnerEvent, TestCase, Trajectory, TrajectoryEvent } from "@canary/core";
import { IPC_MAX_BYTES, IPC_PROTOCOL_VERSION, parseChildMessage, snapshotSourceCase } from "@canary/core";
import { assignFeatureCoverage, emptyCoverage, mergeV8Scripts, summarizeCoverage } from "@canary/coverage";
import type { FeatureEvent } from "@canary/coverage";
import type { CoverageSourceConfig } from "@canary/coverage";
import { evaluateAgent, attributeFailure, createJudgeProvider, type JudgePolicy, type JudgeProvider } from "@canary/evaluators";
import { runHttpAgent, runMcpAgent } from "@canary/adapters";
import { spawnIsolatedNode, assertIsolatedNetwork, denyUncontrolledMcp, type IsolationRequest } from "@canary/isolation";
import { createChildScript } from "./child-script.js";

export type { RunnerEvent } from "@canary/core";

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
  experiences?: LoadedExperience[];
  killGraceMs?: number;
  judge?: JudgeProvider;
  judgePolicy?: JudgePolicy;
  isolation?: IsolationRequest;
}
type ChildMessage =
  | { v: 1; type: "ready" }
  | { v: 1; type: "event"; event: TrajectoryEvent }
  | { v: 1; type: "result"; value: unknown }
  | { v: 1; type: "error"; error: string }
  | { v: 1; type: "coverage"; scripts: CoverageScript[]; partial?: boolean; provisional?: boolean; phase?: "init" | "task" | "final"; processId?: number; isolateId?: string; sequence?: number };

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
  const workerData = JSON.stringify({
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
    experiences: options.experiences ?? [],
  });
  const args = ["--enable-source-maps", "--import", tsxLoader, "-e", createChildScript()];
  if (options.isolation) {
    return spawnIsolatedNode(
      { ...options.isolation, extraEnv: { ...options.isolation.extraEnv, CANARY_WORKER_DATA: workerData } },
      args,
    );
  }
  return spawn(options.nodeExecutable ?? process.execPath, args, {
    cwd,
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      CANARY_WORKER_DATA: workerData,
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
  const executionId = `exec_${randomUUID()}`; const startedAt = Date.now(); const events: Traject