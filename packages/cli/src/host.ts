import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ProjectContext, RunSnapshot } from "@canary/core";

export const HOST_PROTOCOL_VERSION = 1 as const;

export interface HostRunOutput {
  v: typeof HOST_PROTOCOL_VERSION;
  kind: "canary.host.run";
  project: Pick<ProjectContext, "projectRoot" | "configFile" | "artifactRoot" | "source">;
  run: {
    runId: string;
    status: RunSnapshot["status"];
    totalCases: number;
    completedCases: number;
    passedCases: number;
    startedAt: string;
    finishedAt?: string;
    artifactPath: string;
  };
  references: { runId: string; artifactPath: string };
  exitCode: number;
}

export interface HostEvidenceOutput {
  v: typeof HOST_PROTOCOL_VERSION;
  kind: "canary.host.evidence";
  untrustedEvidence: true;
  run: {
    runId: string;
    status: RunSnapshot["status"];
    totalCases: number;
    passedCases: number;
    completedCases: number;
    startedAt: string;
    finishedAt?: string;
  };
  cases: Array<{
    reference: { runId: string; caseId: string; executionId: string; trajectoryId?: string };
    passed: boolean;
    failureCategory?: string;
    assertions: Array<{ id: string; passed: boolean; message?: string }>;
    metrics?: { latencyMs: number; steps: number; toolCalls: number; budgetUsed?: number };
    traceEventTypes: string[];
  }>;
  bounds: {
    maxCases: number;
    maxEventsPerCase: number;
    rawInputIncluded: false;
    rawOutputIncluded: false;
    rawTraceIncluded: false;
  };
}

export interface HostProposal {
  v: typeof HOST_PROTOCOL_VERSION;
  kind: "canary.host.proposal";
  runId: string;
  caseRefs: string[];
  summary: string;
  observations: Array<{ caseId: string; claim: string }>;
  suggestedActions: string[];
  limitations: string[];
}

export interface HostProposalValidation {
  v: typeof HOST_PROTOCOL_VERSION;
  kind: "canary.host.proposal-validation";
  valid: boolean;
  status: "recorded_unapproved" | "rej