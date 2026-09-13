import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CanaryConfig, CoverageSummary, ProjectContext, RunSnapshot, TestCase } from "@canary/core";
import { createCoverageManifest, mergeCoverageSummaries, preparingCoverage } from "@canary/coverage";
import { evaluateCoverageGates, evaluateHardGates, mergeQualityGates, exitCodeForRun } from "@canary/evaluators";
import { proposeFromResults } from "@canary/improvement";
import { ExperienceStore, type ExperienceLoadResult } from "@canary/experience";
import { countJunitFailures, renderReport } from "@canary/reporters";
import { createRunnerPorts, mapLimit, type RunnerPorts } from "@canary/runner";
import { AsyncJsonlTraceStore, redactRunSnapshot, type RunStore } from "@canary/trace";

type ReporterFormat = "json" | "markdown" | "junit" | "console";

function repetitionsFor(testCase: TestCase, fallback: number): number {
  return testCase.options?.repetitions ?? fallback;
}

function diskSnapshot(store: RunStore, runId: string): RunSnapshot {
  return redactRunSnapshot(store.get(runId)!);
}

function writeLiveArtifacts(artifactDir: string, snapshot: RunSnapshot): void {
  writeFileSync(resolve(artifactDir, "run.json"), JSON.stringify(snapshot, null, 2), "utf8");
  if (snapshot.coverage) writeFileSync(resolve(artifactDir, "coverage.json"), JSON.stringify(snapshot.coverage, null, 2), "utf8");
  writeFileSync(resolve(artifactDir, "trajectory.json"), JSON.stringify(snapshot.results.map((result) => ({
    caseId: result.caseId,
    repetition: result.repetition,
    trajectoryId: result.trajectoryId,
    termination: result.trajectory?.termination,
    events: result.trajectory?.events ?? [],
  })), null, 2), "utf8");
  writeFileSync(resolve(artifactDir, "evaluator.json"), JSON.stringify(snapshot.results.map((result) => ({
    caseId: result.caseId,
    repetition: result.repetition,
    execution: {
      status: result.failureCategory === "timeout" ? "timeout" : result.failureCategory === "cancelled" ? "cancelled" : result.failureCategory === "runtime_error" ? "failed" : "completed",
      durationMs: result.metrics?.latencyMs,
    },
    evaluation: { status: result.passed ? "passed" : "failed", failureCategory: result.failureCategory, assertions: result.assertions },
  })), null, 2), "utf8");
}

function writeFinalReports(artifactDir: string, snapshot: RunSnapshot, formats: ReporterFormat[], gate: ReturnType<typeof evaluateCoverageGates>, suggestions: unknown[]): string {
  const reportInput = { runId: snapshot.runId, status: snapshot.status, startedAt: snapshot.startedAt, finishedAt: snapshot.finishedAt, totalCases: snapshot.totalCases, passedCases: snapshot.passedCases, results: snapshot.results, coverage: snapshot.coverage, gate };
  let junitXml = "";
  for (const format of formats) {
    const body = renderReport(reportInput, format);
    if (format === "junit") junitXml = body;
    if (format === "console") {
      writeFileSync(resolve(artifactDir, "report.console.txt"), body, "utf8");
      continue;
    }
    const extension = format === "junit" ? "xml" : format === "markdown" ? "md" : "json";
    writeFileSync(resolve(artifactDir, `report.${extension}`), body, "utf8");
  }
  if (!junitXml) junitXml = renderReport(reportInput, "junit");
  writeFileSync(resolve(artifactDir, "gate.json"), JSON.stringify(gate, null, 2), "utf8");
  writeFileSync(resolve(artifactDir, "improvement.json"), JSON.stringify(suggestions, null, 2), "utf8");
  return junitXml;
}

export interface EvaluationInput {
  store: RunStore;
  config: CanaryConfig;
  context: ProjectContext;
  selected: TestCase[];
  replayOf?: string;
  candidateOf?: string;
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
  const run = input.runId && input.store.get(input.runId)
    ? input.store.get(input.runId)!
    : input.store.create(plan.length, input.runId, input.replayOf);
  const experienceStore = input.experiences ?? new ExperienceStore(resolve(input.context.projectRoot, ".canary", "experiences"));
  const experienceByCase = new Map<string, ExperienceLoadResult>();
  const experienceRefs = new Map<string, { id: string; key: string; version: number; contentHash: string; loadedAt: string }>();
  for (const testCase of input.selected) {
    const loaded = experienceStore.load({ projectRoot: input.context.projectRoot, caseId: testCase.id, tags: testCase.tags, featureIds: testCase.expectedFeatures });
    experienceByCase.set(testCase.id, loaded);
    for (const item of loaded.loaded) experienceRefs.set(item.id, { id: item.id, key: item.key, versio