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
  status: "recorded_unapproved" | "rejected";
  proposalId?: string;
  runId?: string;
  caseRefs?: string[];
  artifactPath?: string;
  approval: { status: "not_approved"; reason: string };
  errors?: string[];
}

export function hostRunOutput(
  context: ProjectContext,
  run: RunSnapshot,
  artifactPath: string,
  exitCode: number,
): HostRunOutput {
  return {
    v: HOST_PROTOCOL_VERSION,
    kind: "canary.host.run",
    project: {
      projectRoot: context.projectRoot,
      configFile: context.configFile,
      artifactRoot: context.artifactRoot,
      source: context.source,
    },
    run: {
      runId: run.runId,
      status: run.status,
      totalCases: run.totalCases,
      completedCases: run.completedCases,
      passedCases: run.passedCases,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      artifactPath,
    },
    references: { runId: run.runId, artifactPath },
    exitCode,
  };
}

function boundedPositiveInteger(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`Expected an integer between 1 and ${maximum}; received ${value}`);
  }
  return value;
}

export function hostEvidenceOutput(
  run: RunSnapshot,
  options: { caseId?: string; maxCases?: number; maxEventsPerCase?: number } = {},
): HostEvidenceOutput {
  const maxCases = boundedPositiveInteger(options.maxCases, 8, 32);
  const maxEventsPerCase = boundedPositiveInteger(options.maxEventsPerCase, 16, 64);
  const selected = options.caseId ? run.results.filter((result) => result.caseId === options.caseId) : run.results;
  if (options.caseId && selected.length === 0) throw new Error(`Case not found in run ${run.runId}: ${options.caseId}`);
  return {
    v: HOST_PROTOCOL_VERSION,
    kind: "canary.host.evidence",
    untrustedEvidence: true,
    run: {
      runId: run.runId,
      status: run.status,
      totalCases: run.totalCases,
      passedCases: run.passedCases,
      completedCases: run.completedCa