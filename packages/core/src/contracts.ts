/** Versioned future contracts. Only ProjectContext is wired into the default run path. */
import type { RunSnapshot } from "./types.js";

export const CONTRACT_VERSION = 1 as const;

export const CORE_CONTRACTS = {
  projectContext: { v: 1, wired: true as const },
  experiment: { v: 1, wired: false as const },
  trial: { v: 1, wired: false as const },
  metric: { v: 1, wired: true as const },
  proposal: { v: 1, wired: false as const },
  authorization: { v: 1, wired: true as const },
  activation: { v: 1, wired: true as const },
} as const;

// "install" is retained for historical consumers only; new resolvers never emit it.
export type ProjectContextSource = "config" | "walk" | "install" | "cwd";

/** R0 roots. artifactRoot is the project artifact collection; runId selects one run directory. */
export interface ProjectContext {
  v: 1;
  invocationRoot: string;
  projectRoot: string;
  configRoot: string;
  configFile: string;
  installRoot?: string;
  artifactRoot: string;
  source: ProjectContextSource;
}

export type MetricAvailability = "available" | "unavailable" | "skipped" | "error";

export interface MetricRecord {
  v: 1;
  name: string;
  value?: number;
  status: MetricAvailability;
  precision?: "exact" | "approximate" | "unknown";
  provenance?: string;
}

/** Declared only. Default `canary run` does not create Experiment records. */
export interface ExperimentRecord {
  v: 1;
  id: string;
  projectRoot: string;
  baselineRunId?: string;
  datasetHash?: string;
  createdAt: string;
  wired: false;
}

/** Declared only. Case × repetition identity for future compare completeness. */
export interface TrialRecord {
  v: 1;
  id: string;
  experimentId: string;
  runId: string;
  caseId: string;
  repetition: number;
  executionId?: string;
  status: "planned" | "running" | "completed" | "failed" | "cancelled" | "missing";
  wired: false;
}

export interface ProposalRecord {
  v: 1;
  id: string;
  runId: string;
  caseId?: string;
  asset: "experience" | "source";
  summary: string;
  contentHash?: string;
  wired: false;
}

export type EvolutionMode = "soft" | "hard";
export type EvolutionActivation = "manual" | "auto_within_policy";
export type AuthorizationAction = "read" | "write" | "apply" | "network" | "tool" | "push" | "loop";
export type ProjectIdentityKind = "owned" | "fork" | "authorized_copy";

/** Wired by H-01. Default `canary run` still does not require an authorization record. */
export interface AuthorizationRecord {
  v: 1;
  id: string;
  subject: string;
  projectRoot: string;
  projectIdentity: { kind: ProjectIdentityKind; evidence: string };
  mode: EvolutionMode;
  activation: EvolutionActivation;
  baseline?: { ref: string; hash: string };
  allow: {
    paths: string[];
    actions: AuthorizationAction[];
  };
  protect: { paths: string[] };
  network: { allowHosts: string[] };
  tools: { allow: string[] };
  envAllowlist: string[];
  budget: { maxCost: number; maxRounds: number; maxMs: number; maxToolCalls: number };
  expiresAt?: string;
  revoked?: boolean;
  revokeId?: string;
  approvedBy?: string;
  approvedAt?: string;
  policyVersion?: string;
  wired: true;
}


export type ExperienceStatus = "proposed" | "validated" | "active" | "expired" | "revoked";
export type ExperienceSourceKind = "human" | "run" | "host_proposal" | "tool_output";

export interface ExperienceScope {
  projectRoot: string;
  caseIds?: string[];
  tags?: string[];
  featureIds?: string[];
  checkIds?: string[];
  checkTypes?: string[];
  tools?: string[];
  languages?: string[];
}

export interface ExperienceProvenance {
  runId: string;
  checkId: string;
  manifestHash: string;
  evidenceHash: string;
  category: string;
  adviceCode: string;
}

export interface ExperienceRecord {
  v: 1;
  id: string;
  key: string;
  version: number;
  status: ExperienceStatus;
  projectRoot: string;
  source: { kind: ExperienceSourceKind; ref?: string };
  summary: string;
  content: string;
  contentHash: string;
  counterexamples: string[];
  scope: ExperienceScope;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  expiryReason?: string;
  validation?: { validatedAt: string; checks: string[] };
  provenance?: ExperienceProvenance;
  limitations?: string[];
  validationRequirements?: string[];
}

export interface ActiveExperiencePointer {
  v: 1;
  projectRoot: string;
  entries: Array<{ id: string; key: string; version: number; contentHash: string }>;
  updatedAt: string;
}

/** The bounded, sanitized context made available to a single Agent execution. */
export interface LoadedExperience {
  id: string;
  key: string;
  version: number;
  contentHash: string;
  content: string;
  scope: ExperienceScope;
}

export interface ExperienceReference {
  id: string;
  key: string;
  version: number;
  contentHash: string;
}

/** Delivery confirms function context arguments, not whether the agent used them. */
export interface ExperienceDeliveryEvidence {
  status: "selected" | "delivered" | "unsupported";
  adapter: "function" | "http" | "mcp";
  references: ExperienceReference[];
  deliveredAt?: string;
}

/** Audit-only selection stored on RunSnapshot; content is deliberately omitted.
 * Legacy records without delivery evidence do not prove delivery. */
export interface ExperienceLoadRecord extends ExperienceReference {
  loadedAt: string;
  selection?: { caseIds?: string[]; checkId?: string; checkType?: string; tool?: string; language?: string };
  delivery?: {
    status: ExperienceDeliveryEvidence["status"];
    adapter: ExperienceDeliveryEvidence["adapter"];
    caseIds?: string[];
    executionIds?: string[];
    deliveredAt?: string;
  };
}

export interface ExecutionOutputCapture {
  maxBytes: number;
  observedBytes: number;
  retainedBytes: number;
  truncated: boolean;
  stdout: string;
  stderr: string;
}

/** New trial evidence must bind every regression execution to actual context delivery. */
export function hasExperienceDelivery(run: Pick<RunSnapshot, "experiences" | "results">, experience: ExperienceReference, regressionCaseIds: string[], holdoutCaseIds: string[]): boolean {
  const matches = (reference: ExperienceReference) => reference.id === experience.id && reference.key === experience.key && reference.version === experience.version && reference.contentHash === experience.contentHash;
  const sameSet = (actual: string[] | undefined, expected: string[]) => Boolean(actual && new Set(actual).size === new Set(expected).size && expected.every((value) => actual.includes(value)));
  const selected = run.experiences?.find(matches);
  const delivered = selected?.delivery;
  const regression = run.results.filter((result) => regressionCaseIds.includes(result.caseId));
  if (!regressionCaseIds.length || !regression.length || !selected || delivered?.status !== "delivered" || delivered.adapter !== "function" || !delivered.deliveredAt) return false;
  if (new Set(regression.map((result) => result.executionId)).size !== regression.length) return false;
  if (!sameSet(selected.selection?.caseIds, regressionCaseIds) || !sameSet(delivered.caseIds, regressionCaseIds) || !sameSet(delivered.executionIds, regression.map((result) => result.executionId))) return false;
  if (!regressionCaseIds.every((caseId) => regression.some((result) => result.caseId === caseId))) return false;
  if (!regression.every((result) => result.experienceDelivery?.status === "delivered" && result.experienceDelivery.adapter === "function" && result.experienceDelivery.deliveredAt && result.experienceDelivery.references.some(matches))) return false;
  return run.results.every((result) => (!holdoutCaseIds.includes(result.caseId) && regressionCaseIds.includes(result.caseId)) || !result.experienceDelivery?.references.some((reference) => reference.id === experience.id));
}

export interface ActivationRecord {
  v: 1;
  id: string;
  proposalId: string;
  authorizationId: string;
  approvedHash: string;
  appliedAt?: string;
  rolledBackAt?: string;
  wired: true;
}
