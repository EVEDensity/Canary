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
  writeFileSync(resolve(artifactDir, "evaluator.json"), JSON.s