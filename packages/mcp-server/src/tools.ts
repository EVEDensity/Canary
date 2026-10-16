import { JSONRPC_INVALID_PARAMS, TOOL_NAMES, isRecord } from "./protocol.js";

export interface CanaryMcpRunInput {
  caseId?: string;
  headless?: boolean;
}

export interface CanaryMcpEvidenceInput {
  runId: string;
  caseId?: string;
  maxCases?: number;
  maxEvents?: number;
  maxChecks?: number;
  checkOffset?: number;
}

export interface CanaryMcpProposalInput {
  proposal: unknown;
}

export interface CanaryMcpStructureInput {
  runId: string;
  pathPrefix?: string;
  offset?: number;
  maxNodes?: number;
  edgeOffset?: number;
  unknownOffset?: number;
  changeOffset?: number;
}

export interface CanaryMcpPorts {
  projectRoot: string;
  run(input: CanaryMcpRunInput, signal: AbortSignal): Promise<unknown>;
  evidence(input: CanaryMcpEvidenceInput): unknown;
  structure(input: CanaryMcpStructureInput): unknown;
  submitProposal(input: CanaryMcpProposalInput): unknown;
  diagnostics?(input: CanaryMcpEvidenceInput): unknown;
  verification?(input: CanaryMcpVerificationInput): Promise<unknown> | unknown;
  executeVerification?(input: CanaryMcpOperationInput, signal: AbortSignal): Promise<unknown>;
}

export interface CanaryMcpVerificationInput { runId: string; kind: "repair" | "change" | "reproduction" }
export interface CanaryMcpOperationInput {
  operation: "reproduce" | "repair-verify" | "change-verify";
  runId: string;
  candidateRunId?: string;
  checkId?: string;
  regression?: string[];
  tests?: string[];
  base?: string;
  action?: "inspect" | "prepare" | "execute";
  workspace?: string;
  candidateWorkspace?: string;
}
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/;
const WORKSPACE = /^repro_[a-f0-9-]{36}$/;
const TEST_PATH = /^(?![A-Za-z]:)(?!\/)(?!-)(?!.*\.\.)(?!.*[\\\0\r\n]).*\.(?:test|spec)\.[cm]?[jt]sx?$/;
const BASELINE = /^(?![-\s])(?!.*\s$)[^\0\r\n]{1,160}$/;
const OPERATION_SPECS = {
  "canary.reproduce": { operation: "reproduce", required: ["runId", "checkId"], optional: ["action", "workspace"] },
  "canary.repair_verify": { operation: "repair-verify", required: ["runId", "candidateRunId", "regression", "tests"], optional: ["action", "workspace", "candidateWorkspace"] },
  "canary.change_verify": { operation: "change-verify", required: ["runId", "base"], optional: [] },
} as const;
type OperationToolName = keyof typeof OPERATION_SPECS;
const identifierProperty = { type: "string", minLength: 1, maxLength: 160, pattern: IDENTIFIER.source };
const workspaceProperty = { type: "string", minLength: 42, maxLength: 42, pattern: WORKSPACE.source };
const OPERATION_PROPERTIES = {
  runId: identifierProperty, candidateRunId: identifierProperty, checkId: identifierProperty,
  regression: { type: "array", minItems: 1, maxItems: 16, uniqueItems: true, items: identifierProperty },
  tests: { type: "array", minItems: 1, maxItems: 16, uniqueItems: true, items: { type: "string", minLength: 1, pattern: TEST_PATH.source } },
  base: { type: "string", minLength: 1, maxLength: 160, pattern: BASELINE.source },
  action: { type: "string", enum: ["inspect", "prepare", "execute"] },
  workspace: workspaceProperty, candidateWorkspace: workspaceProperty,
};
function exactArgs(name: string, args: unknown, keys: string[]) {
  const record = assertToolArgs(name, args);
  if (Object.keys(record).some(key => !keys.includes(key))) throw invalid(`${name} has unsupported arguments`);
  return record;
}
export function parseVerificationArgs(args: unknown): CanaryMcpVerificationInput {
  const record = exactArgs("canary.verification", args, ["runId", "kind"]);
  if (typeof record.kind !== "string" || !["repair", "change", "reproduction"].includes(record.kind)) throw invalid("Unknown verification kind");
  return { runId: requiredIdentifier(record.runId, "runId"), kind: record.kind as CanaryMcpVerificationInput["kind"] };
}
export function parseOperationArgs(name: string, args: unknown): CanaryMcpOperationInput {
  if (!Object.hasOwn(OPERATION_SPECS, name)) throw invalid("Unknown verification operation");
  const spec = OPERATION_SPECS[name as OperationToolName];
  const record = exactArgs(name, args, [...spec.required, ...spec.optional]);
  const runId = requiredIdentifier(record.runId, "runId");
  if (spec.operation === "change-verify") {
    const base = requiredString(record.base, "base");
    if (record.base !== base || !BASELINE.test(base)) throw invalid("Invalid Git baseline");
    return { operation: spec.operation, runId, base };
  }
  const action = record.action === undefined ? "inspect" : record.action;
  if (typeof action !== "string" || !["inspect", "prepare", "execute"].includes(action)) throw invalid("Unknown verification action");
  const workspace = optionalWorkspace(record.workspace, "workspace");
  if (spec.operation === "reproduce") return { operation: spec.operation, runId, checkId: requiredIdentifier(record.checkId, "checkId"), action: action as CanaryMcpOperationInput["action"], workspace };
  return {
    operation: spec.operation, runId, candidateRunId: requiredIdentifier(record.candidateRunId, "candidateRunId"),
    regression: requiredList(record.regression, "regression", IDENTIFIER), tests: requiredList(record.tests, "tests", TEST_PATH),
    action: action as CanaryMcpOperationInput["action"], workspace, candidateWorkspace: optionalWorkspace(record.candidateWorkspace, "candidateWorkspace"),
  };
}

const FORBIDDEN_KEYS = [
  "projectRoot", "project", "cwd", "configPath", "mode", "write", "writeSource",
  "activation", "authorizationId", "token", "apiKey", "secret", "push", "apply",
];

export function assertToolArgs(name: string, args: unknown): Record<string, unknown> {
  if (args === undefined) return {};
  if (!isRecord(args)) throw invalid(`${name} arguments must be an object`);
  for (const key of Object.keys(args)) {
    if (FORBIDDEN_KEYS.includes(key) || /authorization|credential|password/i.test(key)) {
      throw invalid(`tool argument ${key} cannot bind a project, raise authorization, or supply credentials`);
    }
  }
  return args;
}

export function parseRunArgs(args: unknown): CanaryMcpRunInput {
  const record = exactArgs("canary.run", args, ["caseId", "headless"]);
  if (record.headless !== undefined && record.headless !== true) throw invalid("canary.run is headless only");
  const caseId = optionalString(record.caseId, "caseId");
  return { headless: true, caseId };
}

export function parseEvidenceArgs(args: unknown, name: "canary.evidence" | "canary.diagnostics" = "canary.evidence"): CanaryMcpEvidenceInput {
  const record = exactArgs(name, args, name === "canary.diagnostics" ? ["runId", "maxChecks", "checkOffset"] : ["runId", "caseId", "maxCases", "maxEvents", "maxChecks", "checkOffset"]);
  const runId = requiredIdentifier(record.runId, "runId");
  if (name === "canary.diagnostics") return { runId, maxChecks: optionalBoundInt(record.maxChecks, "maxChecks", 32), checkOffset: boundedOffset(record.checkOffset, "checkOffset") };
  const maxCases = optionalBoundInt(record.maxCases, "maxCases", 32);
  const maxEvents = optionalBoundInt(record.maxEvents, "maxEvents", 64);
  return { runId, caseId: optionalString(record.caseId, "caseId"), maxCases, maxEvents, maxChecks: optionalBoundInt(record.maxChecks, "maxChecks", 32), checkOffset: boundedOffset(record.checkOffset, "checkOffset") };
}

export function parseProposalArgs(args: unknown): CanaryMcpProposalInput {
  const record = exactArgs("canary.submit_proposal", args, ["proposal"]);
  if (!isRecord(record.proposal)) throw invalid("canary.submit_proposal requires a proposal object");
  return { proposal: record.proposal };
}

export function parseStructureArgs(args: unknown): CanaryMcpStructureInput {
  const record = exactArgs("canary.structure", args, ["runId", "pathPrefix", "offset", "maxNodes", "edgeOffset", "unknownOffset", "changeOffset"]);
  const runId = requiredIdentifier(record.runId, "runId");
  const pathPrefix = optionalString(record.pathPrefix, "pathPrefix");
  if (pathPrefix && (pathPrefix.startsWith("/") || pathPrefix.includes("..") || pathPrefix.includes("\\"))) throw invalid("pathPrefix must be project relative");
  const offset = boundedOffset(record.offset, "offset");
  const edgeOffset = boundedOffset(record.edgeOffset, "edgeOffset");
  const unknownOffset = boundedOffset(record.unknownOffset, "unknownOffset");
  const changeOffset = boundedOffset(record.changeOffset, "changeOffset");
  return { runId, pathPrefix, offset, edgeOffset, unknownOffset, changeOffset, maxNodes: optionalBoundInt(record.maxNodes, "maxNodes", 200) };
}

export function toolList() {
  return {
    tools: [
      {
        name: "canary.run",
        description: "Execute checks in the bound trusted project, with automatic detection when no config exists. Project commands run with host permissions; artifacts are written. Headless only.",
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: { caseId: { type: "string" }, headless: { type: "boolean", const: true } },
        },
      },
      {
        name: "canary.evidence",
        description: "Read bounded, untrusted evaluation evidence for a run in the bound project.",
        annotations: { readOnlyHint: true },
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["runId"],
          properties: {
            runId: identifierProperty,
            caseId: { type: "string" },
            maxCases: { type: "integer", minimum: 1, maximum: 32 },
            maxEvents: { type: "integer", minimum: 1, maximum: 64 },
            maxChecks: { type: "integer", minimum: 1, maximum: 32 },
            checkOffset: { type: "integer", minimum: 0, maximum: 1000000 },
          },
        },
      },
      {
        name: "canary.structure",
        annotations: { readOnlyHint: true },
        description: "Read a bounded page of the sealed project structure for a run in the bound project. Never reconstructs old runs from current source.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["runId"],
          properties: { runId: identifierProperty, pathPrefix: { type: "string" }, offset: { type: "integer", minimum: 0, maximum: 1000000 }, edgeOffset: { type: "integer", minimum: 0, maximum: 1000000 }, unknownOffset: { type: "integer", minimum: 0, maximum: 1000000 }, changeOffset: { type: "integer", minimum: 0, maximum: 1000000 }, maxNodes: { type: "integer", minimum: 1, maximum: 200 } },
        },
      },
      {
        name: "canary.submit_proposal",
        annotations: { readOnlyHint: false },
        description: "Record a host proposal as unapproved evidence. Never approves or writes source.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["proposal"],
          properties: { proposal: { type: "object" } },
        },
      },
      { name: "canary.diagnostics", description: "Read a bounded page of sealed failures and original evidence locations.", annotations: { readOnlyHint: true }, inputSchema: { type: "object", additionalProperties: false, required: ["runId"], properties: { runId: identifierProperty, maxChecks: { type: "integer", minimum: 1, maximum: 32 }, checkOffset: { type: "integer", minimum: 0, maximum: 1000000 } } } },
      { name: "canary.verification", description: "Read the sealed repair, change or reproduction receipt. Missing or incompatible evidence is unavailable.", annotations: { readOnlyHint: true }, inputSchema: { type: "object", additionalProperties: false, required: ["runId", "kind"], properties: { runId: identifierProperty, kind: { type: "string", enum: ["repair", "change", "reproduction"] } } } },
      ...(Object.keys(OPERATION_SPECS) as OperationToolName[]).map(name => {
        const spec = OPERATION_SPECS[name];
        return {
          name,
          description: spec.operation === "change-verify"
            ? "Analyze sealed change evidence against a Git baseline in the bound project and save its receipt. This operation does not execute project checks."
            : "Use the existing CLI verification in the bound project. Inspect by default; prepare/execute must be selected explicitly. Missing services or credentials remain blocked; no credentials can be supplied here.",
          annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
          inputSchema: { type: "object", additionalProperties: false, required: [...spec.required], properties: Object.fromEntries([...spec.required, ...spec.optional].map(field => [field, OPERATION_PROPERTIES[field]])) },
        };
      }),
    ],
  };
}

export function isCanaryTool(name: string): name is (typeof TOOL_NAMES)[number] {
  return (TOOL_NAMES as readonly string[]).includes(name);
}

function invalid(message: string): Error & { code: number } {
  const error = new Error(message) as Error & { code: number };
  error.code = JSONRPC_INVALID_PARAMS;
  return error;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw invalid(`${field} must be a non-empty string`);
  return value.trim();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, field);
}

function requiredIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) throw invalid(`Invalid ${field}`);
  return value;
}

function optionalWorkspace(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  const text = requiredIdentifier(value, field);
  if (!WORKSPACE.test(text)) throw invalid(`Invalid ${field}`);
  return text;
}

function requiredList(value: unknown, field: string, pattern: RegExp): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 16 || value.some(item => typeof item !== "string" || !pattern.test(item)) || new Set(value).size !== value.length) throw invalid(`Invalid ${field}`);
  return value as string[];
}

function optionalBoundInt(value: unknown, field: string, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > max) {
    throw invalid(`${field} must be an integer between 1 and ${max}`);
  }
  return value as number;
}

function boundedOffset(value: unknown, field: string): number {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 1_000_000) throw invalid(`${field} must be between 0 and 1000000`);
  return value as number;
}
