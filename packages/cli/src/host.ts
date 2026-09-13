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
    if (!allowed.has(key)) errors.push(`Unsupported proposal field: ${key}`);
  }
  if (value.v !== HOST_PROTOCOL_VERSION) errors.push(`v must equal ${HOST_PROTOCOL_VERSION}`);
  if (value.kind !== "canary.host.proposal") errors.push("kind must equal canary.host.proposal");
  if (value.runId !== run.runId) errors.push(`runId must equal ${run.runId}`);
  const summary = typeof value.summary === "string" ? value.summary.trim() : "";
  if (!summary) errors.push("summary must be a non-empty string");
  const caseRefs = stringArray(value.caseRefs, "caseRefs", errors);
  const suggestedActions = stringArray(value.suggestedActions, "suggestedActions", errors);
  const limitations = stringArray(value.limitations, "limitations", errors, false);
  if (!Array.isArray(value.observations) || value.observations.length === 0) {
    errors.push("observations must be a non-empty array");
  } else {
    value.observations.forEach((observation, index) => {
      if (!isRecord(observation) || Object.keys(observation).some((key) => key !== "caseId" && key !== "claim") || typeof observation.caseId !== "string" || !observation.caseId.trim() || typeof observation.claim !== "string" || !observation.claim.trim()) {
        errors.push(`observations[${index}] must contain only non-empty caseId and claim strings`);
      }
    });
  }
  const knownCaseIds = new Set(run.results.map((result) => result.caseId));
  for (const caseId of caseRefs) if (!knownCaseIds.has(caseId)) errors.push(`caseRefs includes unknown case: ${caseId}`);
  if (Array.isArray(value.observations)) {
    for (const observation of value.observations) {
      if (isRecord(observation) && typeof observation.caseId === "string" && !caseRefs.includes(observation.caseId)) errors.push(`observations references a case not declared in caseRefs: ${observation.caseId}`);
    }
  }
  if (run.status !== "completed") errors.push(`Run ${run.runId} is ${run.status}, not completed`);
  if (errors.length) return rejected(errors);

  const proposal: HostProposal = {
    v: HOST_PROTOCOL_VERSION,
    kind: "canary.host.proposal",
    runId: run.runId,
    caseRefs,
    summary,
    observations: (value.observations as Array<Record<string, unknown>>).map((item) => ({ caseId: String(item.caseId).trim(), claim: String(item.claim).trim() })),
    suggestedActions,
    limitations,
  };
  const proposalId = `proposal_${createHash("sha256").update(JSON.stringify(proposal)).digest("hex").slice(0, 16)}`;
  return {
    v: HOST_PROTOCOL_VERSION,
    kind: "canary.host.proposal-validation",
    valid: true,
    status: "recorded_unapproved",
    proposalId,
    runId: proposal.runId,
    caseRefs: proposal.caseRefs,
    approval: {
      status: "not_approved",
      reason: "A host proposal is evidence for human review only; it cannot activate experience or authorize source changes.",
    },
  };
}

function rejected(errors: string[]): HostProposalValidation {
  return {
    v: HOST_PROTOCOL_VERSION,
    kind: "canary.host.proposal-validation",
    valid: false,
    status: "rejected",
    approval: {
      status: "not_approved",
      reason: "Rejected proposals are never approvals and do not change Canary state.",
    },
    errors,
  };
}

export function validateHostProposalFile(proposalPath: string, run: RunSnapshot, artifactRoot: string): HostProposalValidation {
  if (!existsSync(proposalPath)) return rejected([`Proposal file not found: ${proposalPath}`]);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(proposalPath, "utf8"));
  } catch (error) {
    return rejected([`Proposal file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`]);
  }
  const validation = validateHostProposal(raw, run);
  if (!validation.valid) return validation;
  const artifactPath = resolve(artifactRoot, run.runId, "host-proposal.json");
  const record = {
    proposalId: validation.proposalId,
    proposal: raw,
    validation: {
      valid: true,
      status: validation.status,
      recordedAt: new Date().toISOString(),
      approval: validation.approval,
    },
  };
  writeFileSync(artifactPath, JSON.stringify(record, null, 2), "utf8");
  return { ...validation, artifactPath };
}
