import { mkdirSync, existsSync, lstatSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import type { CanaryConfig, CoverageSummary, ProjectContext, RunSnapshot, TestCase } from "@canary/core";
import { createCoverageManifest, mergeCoverageSummaries, preparingCoverage } from "@canary/coverage";
import { evaluateCoverageGates, evaluateHardGates, mergeQualityGates, exitCodeForRun } from "@canary/evaluators";
import { proposeFromResults } from "@canary/improvement";
import { ExperienceStore, type ExperienceLoadResult } from "@canary/experience";
import { countJunitFailures, renderReport } from "@canary/reporters";
import {
  createRunnerPorts,
  mapLimit,
  createExecutionWorkspace,
  recoverStaleRuns,
  writeCheckpoint,
  type RunnerPorts,
  type RunCheckpoint,
} from "@canary/runner";
import { ArtifactIntegrityError, ArtifactPrivacyError, AsyncJsonlTraceStore, FileArtifactRepository, beginArtifacts, sealArtifacts, collectSecretValues, writePrivateJson, writePrivateText, type RunStore } from "@canary/trace";
import { conclusionHash, recordEvidence } from "./evidence.js";

type ReporterFormat = "json" | "markdown" | "junit" | "console";

function repetitionsFor(testCase: TestCase, fallback: number): number {
  return testCase.options?.repetitions ?? fallback;
}

function diskSnapshot(store: RunStore, runId: string): RunSnapshot {
  return store.sanitize(store.get(runId)!);
}

function caseKey(testCase: TestCase, repetition: number, repetitionTotal: number): string {
  return repetitionTotal > 1 ? `${testCase.id}#${repetition}` : testCase.id;
}

function executionStatus(result: { failureCategory?: string; passed: boolean }): string {
  if (result.failureCategory === "timeout") return "timeout";
  if (result.failureCategory === "cancelled") return "cancelled";
  if (result.failureCategory === "budget_exceeded") return "budget_exceeded";
  if (result.failureCategory === "runtime_error") return "failed";
  return result.passed ? "completed" : "failed";
}

function atomicWrite(file: string, value: string): void { writePrivateJson(file, JSON.parse(value)); }
function writeLiveArtifacts(artifactDir: string, snapshot: RunSnapshot): void {
  atomicWrite(resolve(artifactDir, "run.json"), JSON.stringify(snapshot, null, 2));
  if (snapshot.coverage) atomicWrite(resolve(artifactDir, "coverage.json"), JSON.stringify(snapshot.coverage, null, 2));
  atomicWrite(resolve(artifactDir, "trajectory.json"), JSON.stringify(snapshot.results.map((result) => ({
    caseId: result.caseId,
    repetition: result.repetition,
    trajectoryId: result.trajectoryId,
    termination: result.trajectory?.termination,
    events: result.trajectory?.events ?? [],
  })), null, 2));
  atomicWrite(resolve(artifactDir, "evaluator.json"), JSON.stringify(snapshot.results.map((result) => ({
    caseId: result.caseId,
    repetition: result.repetition,
    execution: {
      status: executionStatus(result),
      durationMs: result.metrics?.latencyMs,
    },
    evaluation: { status: result.passed ? "passed" : "failed", failureCategory: result.failureCategory, assertions: result.assertions },
  })), null, 2));
}

function writeFinalReports(artifactDir: string, snapshot: RunSnapshot, formats: ReporterFormat[], gate: ReturnType<typeof evaluateCoverageGates>, suggestions: unknown[]): string {
  const reportInput = { runId: snapshot.runId, status: snapshot.status, startedAt: snapshot.startedAt, finishedAt: snapshot.finishedAt, totalCases: snapshot.totalCases, passedCases: snapshot.passedCases, results: snapshot.results, coverage: snapshot.coverage, gate };
  let junitXml = "";
  for (const format of formats) {
    const body = renderReport(reportInput, format);
    if (format === "junit") junitXml = body;
    if (format === "console") {
      writePrivateText(resolve(artifactDir, "report.console.txt"), body);
      continue;
    }
    const extension = format === "junit" ? "xml" : format === "markdown" ? "md" : "json";
    writePrivateText(resolve(artifactDir, `report.${extension}`), body);
  }
  if (!junitXml) junitXml = renderReport(reportInput, "junit");
  writePrivateJson(resolve(artifactDir, "gate.json"), gate);
  writePrivateJson(resolve(artifactDir, "improvement.json"), suggestions);
  return junitXml;
}

export interface EvaluationInput {
  store: RunStore;
  config: CanaryConfig;
  context: ProjectContext;
  selected: TestCase[];
  replayOf?: string;
  candidateOf?: string;
  retryOf?: string;
  repetitions?: number;
  signal?: AbortSignal;
  consoleReporter?: boolean;
  silent?: boolean;
  runId?: string;
  ports?: RunnerPorts;
  experiences?: ExperienceStore;
}

/** Shared run use-case used by CLI (and Web replay hooks). Does not start HTTP. */
export async function runEvaluation(input: EvaluationInput): Promise<{ runId: string; exitCode: number; artifactPath: string; snapshot: RunSnapshot }> {
  const cwd = input.context.projectRoot;
  const executor = input.ports?.executeCase ?? createRunnerPorts().executeCase;
  const fallbackReps = input.repetitions ?? input.config.runtime?.repetitions ?? 1;
  const plan = input.selected.flatMap((testCase) => {
    const total = repetitionsFor(testCase, fallbackReps);
    return Array.from({ length: total }, (_, index) => ({ testCase, repetition: index + 1, repetitionTotal: total }));
  });
  const repository = new FileArtifactRepository(input.context.artifactRoot);
  await recoverStaleRuns(input.context.artifactRoot, (runId) => repository.readRun(runId));
  const privacy = { secretValues: collectSecretValues({ config: input.config, cases: input.selected }) };
  input.store.setPrivacy(privacy);
  const lineage = { replayOf: input.replayOf, candidateOf: input.candidateOf, retryOf: input.retryOf };
  if (new Set(Object.values(lineage).filter(Boolean)).size > 1) throw new Error("An execution must reference one parent runId");
  const parentId = input.retryOf ?? input.replayOf ?? input.candidateOf;
  const parent = parentId ? repository.verify(parentId) : undefined;
  if (parent && parent.status !== "verified" && parent.status !== "legacy") throw new ArtifactIntegrityError(parent);
  const manifest = createCoverageManifest({ rootDir: cwd, include: input.config.coverage.include, exclude: input.config.coverage.exclude, features: input.config.features });
  const run = input.runId && input.store.get(input.runId)
    ? input.store.get(input.runId)!
    : input.store.create(plan.length, input.runId, input.replayOf);
  const experienceStore = input.experiences ?? new ExperienceStore(resolve(input.context.projectRoot, ".canary", "experiences"));
  const experienceByCase = new Map<string, ExperienceLoadResult>();
  const experienceRefs = new Map<string, { id: string; key: string; version: number; contentHash: string; loadedAt: string }>();
  for (const testCase of input.selected) {
    const loaded = experienceStore.load({ projectRoot: input.context.projectRoot, caseId: testCase.id, tags: testCase.tags, featureIds: testCase.expectedFeatures });
    experienceByCase.set(testCase.id, loaded);
    for (const item of loaded.loaded) experienceRefs.set(item.id, { id: item.id, key: item.key, version: item.version, contentHash: item.contentHash, loadedAt: new Date().toISOString() });
  }
  if (input.candidateOf) input.store.update(run.runId, { candidateOf: input.candidateOf } as Partial<RunSnapshot>);
  if (input.retryOf) input.store.update(run.runId, { retryOf: input.retryOf });
  input.store.update(run.runId, { evidence: recordEvidence(input.config, input.context, input.selected, { ...lineage, parentManifestHash: parent?.manifestHash }, manifest.sourceHash) });
  input.store.update(run.runId, { experiences: [...experienceRefs.values()] });
  const artifactDir = resolve(input.context.artifactRoot, run.runId);
  if (existsSync(resolve(artifactDir, "run.json")) || existsSync(resolve(artifactDir, "manifest.json"))) throw new Error("Run artifacts already exist; use a new runId");
  mkdirSync(artifactDir, { recursive: true });
  const workspace = createExecutionWorkspace({ artifactDir, runId: run.runId });
  const trace = new AsyncJsonlTraceStore(resolve(artifactDir, "trace.jsonl"), { maxQueue: 256, ...privacy });
  let traceError: unknown;
  const pendingCaseKeys = plan.map((item) => caseKey(item.testCase, item.repetition, item.repetitionTotal));
  const checkpoint = (): RunCheckpoint => ({
    v: 1,
    kind: "canary.checkpoint",
    runId: run.runId,
    pid: process.pid,
    status: "running",
    startedAt: run.startedAt,
    updatedAt: new Date().toISOString(),
    artifactDir,
    tmpDir: workspace.tmpDir,
    workDir: workspace.workDir,
    lockPath: workspace.lockPath,
    ports: workspace.ports,
    childPids: [...workspace.childPids],
    completedCaseKeys: diskSnapshot(input.store, run.runId).results.map((result) =>
      result.repetition ? `${result.caseId}#${result.repetition}` : result.caseId,
    ),
    pendingCaseKeys,
  });
  const summaries: CoverageSummary[] = [];
  let cancelled = false;
  const concurrency = input.config.runtime?.concurrency ?? 1;
  let writeChain = Promise.resolve();
  const withWriteLock = async <T>(fn: () => T | Promise<T>): Promise<T> => {
    const next = writeChain.then(fn, fn);
    writeChain = next.then(() => undefined, () => undefined);
    return next;
  };
  // Artifact finalization errors must reach the caller: a passing evaluation cannot mask incomplete evidence.
  const finalize = async (): Promise<void> => {
    try { await trace.close(); }
    finally { await workspace.release(); }
    if (traceError) throw traceError;
    if (workspace.childPids.length) throw new Error("Worker processes remain; artifacts are partial");
    // Ephemeral agent files may contain raw input/output; never retain them as historical evidence.
    for (const name of ["tmp", "work"]) {
      const target = resolve(artifactDir, name);
      if (target !== resolve(workspace.tmpDir) && target !== resolve(workspace.workDir)) throw new Error("Unexpected workspace path");
      if (existsSync(target)) {
        if (lstatSync(target).isSymbolicLink()) throw new Error("Unsafe workspace path");
        rmSync(target, { recursive: true, force: true });
      }
    }
    try { sealArtifacts(artifactDir, { privacy }); }
    catch (error) {
      if (error instanceof ArtifactPrivacyError) {
        const previousGate = input.store.get(run.runId)!.gate;
        input.store.update(run.runId, { status: "failed", evidence: { ...input.store.get(run.runId)!.evidence!, conclusionHash: undefined, privacyFailure: true }, gate: {
          ...previousGate, passed: false, reason: "hard_gate_failed", failureCategory: "policy_violation",
          failures: [...(previousGate?.failures ?? []), { code: "policy_violation", target: "artifact-privacy", message: "Artifact privacy scan failed; detected content was sanitized." }],
        } });
        const failed = diskSnapshot(input.store, run.runId);
        writeLiveArtifacts(artifactDir, failed);
        writeFinalReports(artifactDir, failed, input.config.reporters?.length ? input.config.reporters : ["json", "markdown", "junit"], failed.gate!, failed.improvements ?? []);
        writeCheckpoint({ ...checkpoint(), status: "failed", termination: "error" });
      }
      throw error;
    }
  };
  try {
    beginArtifacts(artifactDir, input.store.get(run.runId)!.evidence!.lineage);
    writeCheckpoint(checkpoint());
    input.store.setCoverage(run.runId, preparingCoverage(run.runId));
    writeLiveArtifacts(artifactDir, diskSnapshot(input.store, run.runId));
    writePrivateJson(resolve(artifactDir, "coverage-manifest.json"), manifest, privacy);
    await mapLimit(plan, concurrency, async (item) => {
      if (input.signal?.aborted) { cancelled = true; return; }
      const result = await executor({
        config: input.config, cwd, runId: run.runId, manifest,
        signal: input.signal,
        workspace,
        onChildPid: (pid) => {
          workspace.recordChildPid(pid);
          writeCheckpoint(checkpoint());
        },
        repetition: item.repetitionTotal > 1 ? item.repetition : undefined,
        repetitionTotal: item.repetitionTotal > 1 ? item.repetitionTotal : undefined,
        experiences: experienceByCase.get(item.testCase.id)?.loaded,
        onEvent: (event) => {
          input.store.appendEvent(run.runId, event);
          void trace.append({ at: new Date().toISOString(), runId: run.runId, trialId: `${item.testCase.id}#${item.repetition}`, ...event }).catch((error) => { traceError = error; });
        },
        onCoverage: (coverage) => {
          input.store.setCoverage(run.runId, coverage);
          if (coverage.status !== "provisional" && coverage.status !== "preparing") summaries.push(coverage);
        },
      }, item.testCase);
      await withWriteLock(() => {
        if (summaries.length) input.store.setCoverage(run.runId, mergeCoverageSummaries(run.runId, summaries, input.config.features, cwd));
        if (!result.passed) input.store.update(run.runId, { status: result.failureCategory === "cancelled" ? "cancelled" : "failed" });
        if (input.consoleReporter && !input.silent) {
          const label = item.repetitionTotal > 1 ? `${item.testCase.id}#${item.repetition}` : item.testCase.id;
          const reason = result.passed ? "" : ` · ${result.assertions.filter((assertion) => !assertion.passed).map((assertion) => assertion.message ?? assertion.id).join("; ") || result.failureCategory || "failed"}`;
          console.log(input.store.sanitize(`${result.passed ? "PASS" : "FAIL"} ${label} (${result.metrics?.latencyMs ?? 0}ms)${reason}`));
        }
        writeLiveArtifacts(artifactDir, diskSnapshot(input.store, run.runId));
        const done = caseKey(item.testCase, item.repetition, item.repetitionTotal);
        const remaining = pendingCaseKeys.filter((key) => key !== done);
        pendingCaseKeys.splice(0, pendingCaseKeys.length, ...remaining);
        writeCheckpoint({
          ...checkpoint(),
          status: input.signal?.aborted || result.failureCategory === "cancelled" ? "interrupted" : "running",
          termination: result.trajectory?.termination === "timeout" || result.trajectory?.termination === "cancelled" || result.trajectory?.termination === "budget_exceeded"
            ? result.trajectory.termination
            : undefined,
        });
      });
      if (result.failureCategory === "cancelled" || input.signal?.aborted) cancelled = true;
    });
    await trace.flush();
    if (traceError) throw traceError;
    if (summaries.length) input.store.setCoverage(run.runId, mergeCoverageSummaries(run.runId, summaries, input.config.features, cwd));
    const final = cancelled ? input.store.finish(run.runId, "cancelled") : input.store.finish(run.runId);
    const suggestions = proposeFromResults(final.runId, final.results);
    const coverageGate = evaluateCoverageGates(final.coverage, input.config.coverage);
    const hardGate = evaluateHardGates({
      results: final.results,
      coverage: final.coverage,
      coreFeatures: input.config.features?.map((feature) => feature.id),
    });
    const gate = mergeQualityGates(coverageGate, hardGate);
    input.store.update(run.runId, { ...(!gate.passed && final.status !== "cancelled" ? { status: "failed" as const } : {}), improvements: suggestions, gate });
    input.store.update(run.runId, { evidence: { ...input.store.get(run.runId)!.evidence!, conclusionHash: conclusionHash(diskSnapshot(input.store, run.runId)) } });
    const redacted = diskSnapshot(input.store, run.runId);
    const formats = (input.config.reporters?.length ? input.config.reporters : ["json", "markdown", "junit"]) as ReporterFormat[];
    const junitXml = writeFinalReports(artifactDir, redacted, formats, input.store.sanitize(gate), input.store.sanitize(suggestions));
    writeLiveArtifacts(artifactDir, redacted);
    writeCheckpoint({
      ...checkpoint(),
      status: redacted.status === "cancelled" ? "cancelled" : redacted.status === "failed" ? "failed" : "completed",
      pendingCaseKeys: [...pendingCaseKeys],
    });
    const junitFailures = countJunitFailures(junitXml);
    const exitCode = exitCodeForRun({
      runFailed: redacted.status !== "completed",
      gatePassed: gate.passed && redacted.status !== "cancelled",
      junitFailures: Number.isFinite(junitFailures) ? junitFailures : 1,
    });
    if (!gate.passed && !input.silent) {
      const label = gate.reason === "hard_gate_failed" ? "hard-gate" : "coverage-gate";
      console.log(input.store.sanitize(`${label}: fail · ${gate.reason} · ${gate.failures.map((item) => item.message).join("; ")}`));
    }
    return { runId: run.runId, exitCode, artifactPath: resolve(artifactDir, "run.json"), snapshot: redacted };
  } catch (error) {
    input.store.reportError(run.runId, error instanceof Error ? error.message : String(error));
    input.store.finish(run.runId, "failed");
    writeLiveArtifacts(artifactDir, diskSnapshot(input.store, run.runId));
    writeCheckpoint({ ...checkpoint(), status: "failed", termination: "error" });
    throw error;
  } finally {
    await finalize();
  }
}
