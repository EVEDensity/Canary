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

function repetitionsFor(testCase: TestCase, fa