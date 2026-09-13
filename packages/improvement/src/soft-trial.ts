import type { ActiveExperiencePointer, CoverageGateResult, RunSnapshot } from "@canary/core";

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
  if (!input.comparison.comparable || !input.comparison.completeness.passed) reasons.push(...input.comparison.completeness.reasons, "baselin