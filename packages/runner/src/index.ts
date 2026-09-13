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
  const next