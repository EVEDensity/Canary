import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { CanaryConfig, CanaryModelConfig, CanaryToolsConfig, CoverageScript, CoverageSummary, EvalResult, ExecutionOutputCapture, ExperienceDeliveryEvidence, ExperienceReference, FeatureDefinition, LoadedExperience, RunnerEvent, TestCase, Trajectory, TrajectoryEvent } from "@canary/core";
import { IPC_MAX_BYTES, IPC_PROTOCOL_VERSION, parseChildMessage, snapshotSourceCase } from "@canary/core";
import { assignFeatureCoverage, emptyCoverage, mergeV8Scripts, summarizeCoverage } from "@canary/coverage";
import type { FeatureEvent } from "@canary/coverage";
import type { CoverageSourceConfig } from "@canary/coverage";
import { evaluateAgent, attributeFailure, createJudgeProvider, type JudgePolicy, type JudgeProvider } from "@canary/evaluators";
import { runHttpAgent, runMcpAgent } from "@canary/adapters";
import { BoundedExecutionOutput, spawnIsolatedNode, assertIsolatedNetwork, denyUncontrolledMcp, killProcessTree, PROCESS_ADAPTER, waitForExit, type IsolationRequest } from "@canary/isolation";
import { createChildScript } from "./child-script.js";
import { budgetExceeded, budgetUsed, classifyRemoteFailure, classifyTermination, failureMessageFor } from "./lifecycle.js";
import { defaultTmpRoot, isolatedEnv, type ExecutionWorkspace } from "./workspace.js";

export type { RunnerEvent } from "@canary/core";
export { killProcessTree, pidAlive, reclaimOrphans, waitForExit, PROCESS_ADAPTER } from "@canary/isolation";
export { budgetExceeded, budgetUsed, classifyRemoteFailure, classifyTermination } from "./lifecycle.js";
export { RunIsolationError, acquireRunLock, createExecutionWorkspace, isolatedEnv, releaseRunLock, reservePort, assertExclusiveTempDir } from "./workspace.js";
export type { ExecutionWorkspace, IsolationFaultCode, PortLease } from "./workspace.js";
export { findCheckpointForPid, listCheckpoints, readCheckpoint, recoverPartialRun, recoverStaleRuns, writeCheckpoint } from "./checkpoint.js";
export type { RecoveredRun, RunCheckpoint } from "./checkpoint.js";

export const DEFAULT_SAMPLE_INTERVAL_MS = 1000;
export const DEFAULT_KILL_GRACE_MS = 500;

export interface ExecutionOptions {
  reproducibility?: { clock?: string; seed?: number };
  cwd?: string;
  timeoutMs?: number;
  maxSteps?: number;
  maxToolCalls?: number;
  maxBudget?: number;
  maxOutputBytes?: number;
  nodeExecutable?: string;
  entry: string;
  requestField?: string;
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
  workspace?: ExecutionWorkspace;
  onChildPid?: (pid: number) => void;
}
type ChildMessage =
  | { v: 1; type: "ready" }
  | { v: 1; type: "event"; event: TrajectoryEvent }
  | { v: 1; type: "result"; value: unknown }
  | { v: 1; type: "error"; error: string }
  | { v: 1; type: "experiences.delivered"; references: ExperienceReference[]; deliveredAt: string }
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

function spawnExecution(options: ExecutionOptions, executionId: string, workerAuth: string): { child: ChildProcess; tmpDir: string; ephemeralTmp: boolean } {
  const cwd = options.cwd ?? process.cwd();
  const require = createRequire(import.meta.url);
  const tsxLoader = pathToFileURL(require.resolve("tsx")).href;
  const entry = pathToFileURL(resolve(cwd, options.entry)).href;
  const ephemeralTmp = !options.workspace;
  const tmpDir = options.workspace?.tmpDir ?? join(defaultTmpRoot(), `canary-exec-${options.runId}-${executionId}`);
  mkdirSync(tmpDir, { recursive: true });
  const workerData = JSON.stringify({
    workerAuth,
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
    reproducibility: options.reproducibility,
  });
  const args = ["--enable-source-maps", "--import", tsxLoader, "-e", createChildScript()];
  const env = isolatedEnv(
    tmpDir,
    {
      CANARY_RUN_ID: options.runId,
      CANARY_CASE_ID: options.caseId,
      CANARY_WORKDIR: options.workspace?.workDir,
      CANARY_WORKER_DATA: workerData,
    },
    options.workspace?.env ?? process.env,
  );
  const child = options.isolation
    ? spawnIsolatedNode(
        { ...options.isolation, extraEnv: { ...options.isolation.extraEnv, ...env } },
        args,
      )
    : spawn(options.nodeExecutable ?? process.execPath, args, {
        cwd,
        detached: PROCESS_ADAPTER.usesProcessGroups,
        windowsHide: true,
        env,
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      });
  return { child, tmpDir, ephemeralTmp };
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
function experienceDeliveryFor(options: ExecutionOptions, adapter: ExperienceDeliveryEvidence["adapter"]): ExperienceDeliveryEvidence {
  return { status: adapter === "function" ? "selected" : "unsupported", adapter, references: (options.experiences ?? []).map(({ id, key, version, contentHash }) => ({ id, key, version, contentHash })) };
}

export async function runExecution(options: ExecutionOptions): Promise<EvalResult> {
  const executionId = `exec_${randomUUID()}`; const startedAt = Date.now(); const events: TrajectoryEvent[] = [];
  const workerAuth = randomUUID();
  let experienceDelivery = experienceDeliveryFor(options, "function");
  if (options.signal?.aborted) {
    options.onEvent?.({ type: "execution.started", runId: options.runId, executionId, caseId: options.caseId });
    const coverage = emptyCoverage(options.runId);
    options.onCoverage?.(coverage);
    options.onEvent?.({ type: "execution.failed", executionId, error: "Execution cancelled" });
    return finishEvaluation(options, executionId, startedAt, events, undefined, "Execution cancelled", coverage, "cancelled", { experienceDelivery });
  }
  const capture = new BoundedExecutionOutput(options.maxOutputBytes);
  const spawned = spawnExecution(options, executionId, workerAuth);
  const child = spawned.child; let settled = false; let failure: string | undefined; let output: unknown;
  let authenticatedCompletion = false; let protocolFailure = false;
  let scripts: CoverageScript[] = []; let initScripts: CoverageScript[] = []; let coveragePartial = false;
  let didTimeout = false; let didCancel = false; let didBudget = false;
  let lastProvisionalKey = ""; let lastProvisionalAt = 0;
  if (child.pid) {
    options.workspace?.recordChildPid(child.pid);
    options.onChildPid?.(child.pid);
  }
  const sampleMinIntervalMs = options.coverage.sampleMinIntervalMs ?? 200;
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  let killTimer: NodeJS.Timeout | undefined;
  let stoppingPid: number | undefined;
  const stopChild = (): void => {
    if (!child.pid || child.exitCode !== null || stoppingPid) return;
    stoppingPid = child.pid;
    killProcessTree(stoppingPid, PROCESS_ADAPTER.terminateSignal);
    // Descendants can survive even after the process-group leader exits.
    const pid = stoppingPid;
    killTimer = setTimeout(() => { killProcessTree(pid, PROCESS_ADAPTER.killSignal); }, killGraceMs);
  };
  options.onEvent?.({ type: "execution.started", runId: options.runId, executionId, caseId: options.caseId });
  child.stderr?.on("data", (chunk: Buffer) => {
    capture.append("stderr", chunk);
    if (capture.truncated && !didBudget && !didCancel && !didTimeout) {
      didBudget = true;
      failure ??= `Execution output exceeded ${capture.maxBytes} bytes`;
      stopChild();
    }
  });
  const cancel = (): void => { if (!settled && !didCancel) { didCancel = true; failure = "Execution cancelled"; stopChild(); } };
  options.signal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(() => {
    if (!settled && !didCancel && !didBudget) {
      didTimeout = true;
      failure = `Execution timed out after ${options.timeoutMs ?? 60_000}ms`;
      stopChild();
    }
  }, options.timeoutMs ?? 60_000);
  await new Promise<void>((resolvePromise) => {
    const done = (): void => { if (!settled) { settled = true; resolvePromise(); } };
    child.on("message", (raw: unknown) => {
      if (!isRecord(raw) || raw.auth !== workerAuth) {
        protocolFailure = true;
        failure ??= "Unauthenticated execution IPC message";
        return;
      }
      const envelope = { ...raw };
      delete envelope.auth;
      let message: ChildMessage;
      try { message = parseChildMessage(envelope) as ChildMessage; }
      catch (error) { protocolFailure = true; failure ??= error instanceof Error ? error.message : String(error); return; }
      if (message.type === "event") {
        events.push(message.event);
        options.onEvent?.({ type: "trace.event", executionId, event: message.event });
        const over = budgetExceeded(events, { maxSteps: options.maxSteps, maxToolCalls: options.maxToolCalls, maxBudget: options.maxBudget });
        if (over && !settled && !didCancel && !didTimeout && !didBudget) {
          didBudget = true;
          failure = over;
          stopChild();
        }
      }
      else if (message.type === "experiences.delivered") {
        if (!experienceDelivery.references.length || JSON.stringify(message.references) !== JSON.stringify(experienceDelivery.references)) {
          protocolFailure = true;
          failure ??= "Experience delivery acknowledgement does not match selected references";
          return;
        }
        experienceDelivery = { ...experienceDelivery, status: "delivered", deliveredAt: message.deliveredAt };
      }
      else if (message.type === "result") { authenticatedCompletion = true; output = message.value; }
      else if (message.type === "error") { authenticatedCompletion = true; failure ??= message.error; }
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
    child.once("close", (code: number | null) => {
      if (code && !failure && !didTimeout && !didCancel && !didBudget) {
        const stderr = capture.finish().stderr.trim();
        failure = stderr ? `Execution child exited with code ${code}: ${stderr}` : `Execution child exited with code ${code}`;
      }
      done();
    });
  });
  // Closing the parent must not cancel cleanup of descendants that ignore SIGTERM.
  if (stoppingPid) killProcessTree(stoppingPid, PROCESS_ADAPTER.killSignal);
  if (killTimer) clearTimeout(killTimer);
  clearTimeout(timeout); options.signal?.removeEventListener("abort", cancel);
  if (child.pid) await waitForExit(child.pid, Math.max(killGraceMs, 500));
  if (spawned.ephemeralTmp) {
    try { rmSync(spawned.tmpDir, { recursive: true, force: true }); } catch { /* keep evidence if the OS still holds the dir */ }
  }
  const outputCapture = capture.finish();
  if (outputCapture.truncated) { didBudget = true; failure ??= `Execution output exceeded ${capture.maxBytes} bytes`; }
  if (!authenticatedCompletion && !didTimeout && !didCancel && !didBudget) {
    protocolFailure = true;
    failure ??= "Execution child closed without an authenticated completion";
  }
  const termination = classifyTermination({ cancelled: didCancel, timeout: didTimeout, budgetExceeded: didBudget, error: Boolean(failure) });
  failure = failureMessageFor(termination, failure);
  const coverage = makeCoverage(options, scripts, coveragePartial || termination !== "completed", events, initScripts.length > 0);
  options.onCoverage?.(coverage); options.onEvent?.({ type: "coverage.updated", executionId, coverage });
  if (failure) options.onEvent?.({ type: "execution.failed", executionId, error: failure });
  return finishEvaluation(options, executionId, startedAt, events, output, failure, coverage, termination, { experienceDelivery, outputCapture }, protocolFailure);
}

export interface RunOptions { config: CanaryConfig; cwd?: string; runId: string; onEvent?: (event: RunnerEvent) => void; onCoverage?: (summary: CoverageSummary) => void; manifest?: CoverageSourceConfig["manifest"]; signal?: AbortSignal; repetition?: number; repetitionTotal?: number; judge?: JudgeProvider; judgePolicy?: JudgePolicy; experiences?: LoadedExperience[]; isolation?: IsolationRequest; workspace?: ExecutionWorkspace; onChildPid?: (pid: number) => void }

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

async function finishEvaluation(options: ExecutionOptions, executionId: string, startedAt: number, events: TrajectoryEvent[], output: unknown, failure: string | undefined, coverage: CoverageSummary, termination: Trajectory["termination"], evidence: { experienceDelivery: ExperienceDeliveryEvidence; outputCapture?: ExecutionOutputCapture }, protocolFailure = false): Promise<EvalResult> {
  const trajectory: Trajectory = { id: `trajectory_${executionId}`, runId: options.runId, caseId: options.caseId, events, stepCount: events.filter((event) => event.type === "tool_call" || event.type === "tool.call").length, termination };
  const testCase: TestCase = options.testCase ?? { id: options.caseId, input: options.input, assertions: [] };
  const stateDiff = stateDiffFor(testCase, events, output);
  const evaluation = await evaluateAgent({ assertions: testCase.assertions ?? [], context: { testCase, output, trajectory, executionStatus: trajectory.termination, latencyMs: Date.now() - startedAt, toolCalls: trajectory.stepCount, budgetUsed: budgetUsed(events), expectedFeatures: testCase.expectedFeatures, featureStatuses: Object.fromEntries(coverage.featureChains.map((feature) => [feature.featureId, feature.status])), coverage, state: stateDiff.after, judge: options.judge, judgePolicy: options.judgePolicy } });
  const expectedTermination = (testCase.assertions ?? []).some((assertion) => assertion.type === "execution.termination" && "expected" in assertion && assertion.expected === trajectory.termination);
  const runtimePassed = !protocolFailure && (!failure || expectedTermination) && !evidence.outputCapture?.truncated;
  const passed = runtimePassed && evaluation.passed;
  const result: EvalResult = {
    runId: options.runId, executionId, caseId: options.caseId,
    ...(options.repetition ? { repetition: options.repetition, repetitionTotal: options.repetitionTotal } : {}),
    passed, assertions: [{ id: "agent.completed", passed: runtimePassed, message: failure ?? "Agent completed" }, ...evaluation.assertions], coverage, output, input: options.input,
    metrics: { latencyMs: Date.now() - startedAt, steps: trajectory.stepCount, toolCalls: trajectory.stepCount, budgetUsed: budgetUsed(events) },
    trajectoryId: trajectory.id, trajectory, stateDiff, createdAt: new Date().toISOString(),
    sourceCase: snapshotSourceCase(testCase),
    ...evidence,
  };
  if (evidence.outputCapture?.truncated) result.assertions.push({ id: "execution.output_budget", passed: false, message: `Execution output exceeded ${evidence.outputCapture.maxBytes} bytes; diagnostic output was truncated` });
  if (!passed) result.failureCategory = attributeFailure(result).kind;
  options.onEvent?.({ type: "execution.finished", executionId, result });
  return result;
}

export async function runHttpExecution(options: ExecutionOptions): Promise<EvalResult> {
  const executionId = `exec_${randomUUID()}`; const startedAt = Date.now(); const events: TrajectoryEvent[] = [];
  options.onEvent?.({ type: "execution.started", runId: options.runId, executionId, caseId: options.caseId });
  const emit = (event: TrajectoryEvent) => { events.push(event); options.onEvent?.({ type: "trace.event", executionId, event }); };
  emit({ type: "http.request", timestamp: new Date().toISOString(), url: options.entry });
  if (options.isolation) assertIsolatedNetwork(options.entry, { allowHosts: options.isolation.policy.networkAllowHosts });
  let output: unknown; let failure: string | undefined; let termination: Trajectory["termination"] = "completed";
  const timedOut = { current: false };
  const timer = setTimeout(() => { timedOut.current = true; }, options.timeoutMs ?? 10_000);
  try {
    output = await runHttpAgent(options.entry, options.input, options.timeoutMs ?? 10_000, options.signal, options.requestField);
    emit({ type: "http.response", timestamp: new Date().toISOString() });
  } catch (error) {
    const aborted = error instanceof Error && (error.name === "AbortError" || /abort/i.test(error.message));
    const classified = classifyRemoteFailure(error, {
      cancelled: Boolean(options.signal?.aborted),
      timeout: (timedOut.current || aborted) && !options.signal?.aborted,
    });
    failure = classified.failure;
    termination = classified.termination;
    options.onEvent?.({ type: "execution.failed", executionId, error: failure });
  } finally {
    clearTimeout(timer);
  }
  const coverage = emptyCoverage(options.runId);
  options.onCoverage?.(coverage);
  options.onEvent?.({ type: "coverage.updated", executionId, coverage });
  return finishEvaluation(options, executionId, startedAt, events, output, failure, coverage, termination, { experienceDelivery: experienceDeliveryFor(options, "http") });
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
  if (options.isolation) denyUncontrolledMcp();
  let output: unknown; let failure: string | undefined; let termination: Trajectory["termination"] = "completed";
  const timedOut = { current: false };
  const timer = setTimeout(() => { timedOut.current = true; }, options.timeoutMs ?? 10_000);
  try {
    output = await runMcpAgent(command, args, options.input, options.timeoutMs ?? 10_000, options.signal);
    emit({ type: "mcp.response", timestamp: new Date().toISOString() });
  } catch (error) {
    const aborted = error instanceof Error && (error.name === "AbortError" || /abort/i.test(error.message));
    const classified = classifyRemoteFailure(error, {
      cancelled: Boolean(options.signal?.aborted),
      timeout: (timedOut.current || aborted) && !options.signal?.aborted,
    });
    failure = classified.failure;
    termination = classified.termination;
    options.onEvent?.({ type: "execution.failed", executionId, error: failure });
  } finally {
    clearTimeout(timer);
  }
  const coverage = emptyCoverage(options.runId);
  options.onCoverage?.(coverage);
  options.onEvent?.({ type: "coverage.updated", executionId, coverage });
  return finishEvaluation(options, executionId, startedAt, events, output, failure, coverage, termination, { experienceDelivery: experienceDeliveryFor(options, "mcp") });
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
    reproducibility: options.config.artifacts?.reproducibility,
    cwd: options.cwd,
    entry: options.config.agent.entry,
    requestField: options.config.agent.requestField,
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
    experiences: options.experiences,
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
    judge: options.judge ?? (options.config.judge ? createJudgeProvider(options.config.judge) : undefined),
    judgePolicy: options.judgePolicy ?? { required: options.config.judge?.required, providerKind: options.config.judge?.provider },
    isolation: options.isolation,
    workspace: options.workspace,
    onChildPid: options.onChildPid,
  };
  if (options.config.agent.adapter === "http") return runHttpExecution(shared);
  if (options.config.agent.adapter === "mcp") return runMcpExecution(shared);
  return runExecution(shared);
}

export interface RunnerPorts {
  executeCase: typeof runConfiguredCase;
}

export function createRunnerPorts(): RunnerPorts {
  return { executeCase: runConfiguredCase };
}
