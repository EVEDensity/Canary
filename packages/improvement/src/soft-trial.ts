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
  budget: { maxCases: number; maxChars: number; observedCases?: number; o