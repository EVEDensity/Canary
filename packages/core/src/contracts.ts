/** Versioned future contracts. Only ProjectContext is wired into the default run path. */

export const CONTRACT_VERSION = 1 as const;

export const CORE_CONTRACTS = {
  projectContext: { v: 1, wired: true as const },
  experiment: { v: 1, wired: false as const },
  trial: { v: 1, wired: false as const },
  metric: { v: 1, wired: true as const },
  proposal: { v: 1, wired: false as const },
  authorization: { v: 1, wired: false as const },
  activation: { v: 1, wired: false as const },
} as const;

export type ProjectContextSource = "config" | "walk" | "install" | "cwd";

/** Roots used by every CLI command. artifactRoot always follows projectRoot. */
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

export interface AuthorizationRecord {
  v: 1;
  id: string;
  subject: string;
  projectRoot: string;
  mode: "soft" | "hard";
  activation: "manual" | "auto_within_policy";
  expiresAt?: string;
  revoked?: boolean;
  wired: false;
}

export interface ActivationRecord {
  v: 1;
  id: string;
  proposalId: string;
  authorizationId: string;
  approvedHash: string;
  appliedAt?: string;
  rolledBackAt?: string;
  wired: false;
}
