import type { ActiveExperiencePointer, CoverageGateResult, RunSnapshot } from "@canary/core";
import { createHash } from "node:crypto";

export function softTrialDatasetIdentity(results: RunSnapshot["results"]): string {
  return createHash("sha256").update(JSON.stringify(results.map((result) => ({ id: result.caseId, repetition: result.repetition, dataset: result.sourceCase?.dataset ?? null })))).digest("hex");
}

export type SoftTrialStatus = "prepared" | "validated" | "rejected" | "approved" | "activated" | "rolled_back";

export interface SoftTrialAuthorization {
  status: "not_approved" | "approved";
  actor?: string;
  reason?: string;
  approvedAt?: string;
}

export interface SoftTrialValidation {
  valid: boolean;
  reasons: string[];
  candidateRunId: string;
  comparisonArtifact: string;
  regressionCaseIds: string[];
  holdoutCaseIds: string[];
  validatedAt: string;
}

export interface SoftTrialRecord {
  v: 1;
  id: string;
  projectRoot: string;
  configPath: string;
  baselineRunId: string;
  experienceId: string;
  experienceContentHash: string;
  experienceIdentityHash?: string;
  datasetIdentity: string;
  regressionCaseIds: string[];
  holdoutCaseIds: string[];
  budget: { maxCases: number; maxChars: number; observedCases?: number; observedChars?: number };
  status: SoftTrialStatus;
  authorization: SoftTrialAuthorization;
  priorActive?: ActiveExperiencePointer;
  validation?: SoftTrialValidation;
  nextRunId?: string;
}

interface ComparableResult {
  caseId: string;
  repetition?: number;
  passed: boolean;
}

interface ComparableRun {
  runId: string;
  status: string;
  results: ComparableResult[];
  gate?: CoverageGateResult;
}

interface Comparison {
  verdict: "keep" | "improve" | "reject" | "incomparable";
  comparable: boolean;
  regressions: string[];
  improvements: string[];
  completeness: { passed: boolean; reasons: string[] };
  admission: { verdict: "admit" | "reject" | "hold" | "incomparable"; reasons: string[] };
}

function trialKey(result: Pick<ComparableResult, "caseId" | "repetition">): string {
  return result.repetition === undefined ? result.caseId : `${result.caseId}#${result.repetition}`;
}

function includesCase(keys: string[], caseId: string): boolean {
  return keys.some((key) => key === caseId || key.startsWith(`${caseId}#`));
}

/** Objective S-04 gate. Human approval is deliberately separate from this evidence check. */
export function assessSoftTrial(input: {
  baseline: ComparableRun;
  candidate: ComparableRun;
  comparison: Comparison;
  regressionCaseIds: string[];
  holdoutCaseIds: string[];
  candidateExitCode: number;
  comparisonArtifact: string;
  now?: string;
}): SoftTrialValidation {
  const reasons: string[] = [];
  const candidateResults = input.candidate.results;
  if (!input.regressionCaseIds.length) reasons.push("independent regression set is empty");
  if (!input.holdoutCaseIds.length) reasons.push("independent holdout set is empty");
  if (!input.comparison.comparable || !input.comparison.completeness.passed) reasons.push(...input.comparison.completeness.reasons, "baseline and candidate results are not comparable");
  if (input.candidate.status !== "completed" || input.candidateExitCode !== 0) reasons.push("candidate run did not complete with exit code 0");
  if (input.comparison.verdict !== "improve") reasons.push(`candidate comparison verdict is ${input.comparison.verdict}, expected improve`);
  if (input.comparison.regressions.length) reasons.push(`candidate regressions: ${input.comparison.regressions.join(", ")}`);
  if (input.comparison.admission.verdict === "reject" || input.comparison.admission.verdict === "incomparable") reasons.push(...input.comparison.admission.reasons, `admission verdict is ${input.comparison.admission.verdict}`);
  if (input.candidate.gate?.hardGate?.passed === false || input.candidate.gate?.reason === "hard_gate_failed") reasons.push("candidate hard gate failed; required Judge or policy/state evidence is missing");
  if (candidateResults.some((result) => !result.passed)) reasons.push("candidate contains failed or missing-quality trials");
  const improvedRegression = input.comparison.improvements.some((key) => input.regressionCaseIds.some((caseId) => includesCase([key], caseId)));
  if (!improvedRegression) reasons.push("candidate did not improve an independent regression case");
  const candidateKeys = new Set(candidateResults.map(trialKey));
  for (const caseId of input.holdoutCaseIds) {
    if (![...candidateKeys].some((key) => includesCase([key], caseId))) reasons.push(`holdout result missing: ${caseId}`);
  }
  return {
    valid: reasons.length === 0,
    reasons: [...new Set(reasons)],
    candidateRunId: input.candidate.runId,
    comparisonArtifact: input.comparisonArtifact,
    regressionCaseIds: input.regressionCaseIds,
    holdoutCaseIds: input.holdoutCaseIds,
    validatedAt: input.now ?? new Date().toISOString(),
  };
}
