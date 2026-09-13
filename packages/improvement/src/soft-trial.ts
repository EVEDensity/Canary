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

function 