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
      completedCases: run.completedCases,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    },
    cases: selected.slice(0, maxCases).map((result) => ({
      reference: {
        runId: result.runId,
        caseId: result.caseId,
        executionId: result.executionId,
        ...(result.trajectoryId ? { trajectoryId: result.trajectoryId } : {}),
      },
      passed: result.passed,
      ...(result.failureCategory ? { failureCategory: result.failureCategory } : {}),
      assertions: result.assertions.map((assertion) => ({
        id: assertion.id,
        passed: assertion.passed,
        ...(assertion.message ? { message: assertion.message } : {}),
      })),
      ...(result.metrics ? { metrics: result.metrics } : {}),
      traceEventTypes: (result.trajectory?.events ?? []).slice(0, maxEventsPerCase).map((event) => event.type),
    })),
    bounds: {
      maxCases,
      maxEventsPerCase,
      rawInputIncluded: false,
      rawOutputIncluded: false,
      rawTraceIncluded: false,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown, field: string, errors: string[], required = true): string[] {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    errors.push(`${field} must be a non-empty string array`);
    return [];
  }
  if (required && value.length === 0) errors.push(`${field} must not be empty`);
  return value.map((item) => item.trim());
}

export function validateHostProposal(value: unknown, run: RunSnapshot): HostProposalValidation {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return rejected(["Proposal must be a JSON object"]);
  }
  const allowed = new Set(["v", "kind", "runId", "caseRefs", "summary", "observations", "suggestedActions", "limitations"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`Unsupported proposal field: $