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
}

const FORBIDDEN_KEYS = [
  "projectRoot", "project", "cwd", "configPath", "mode", "write", "writeSource",
  "activation", "authorizationId", "token", "apiKey", "secret", "push", "apply",
];

export function assertToolArgs(name: string, args: unknown): Record<string, unknown> {
  if (args === undefined || args === null) return {};
  if (!isRecord(args)) throw invalid(`${name} arguments must be an object`);
  for (const key of Object.keys(args)) {
    if (FORBIDDEN_KEYS.includes(key) || /authorization|credential|password/i.test(key)) {
      throw invalid(`tool argument ${key} cannot bind a project, raise authorization, or supply credentials`);
    }
  }
  return args;
}

export function parseRunArgs(args: unknown): CanaryMcpRunInput {
  const record = assertToolArgs("canary.run", args);
  if (record.headless === false) throw invalid("canary.run is headless only");
  const caseId = optionalString(record.caseId, "caseId");
  return { headless: true, caseId };
}

export function parseEvidenceArgs(args: unknown): CanaryMcpEvidenceInput {
  const record = assertToolArgs("canary.evidence", args);
  const runId = requiredString(record.runId, "runId");
  const maxCases = optionalBoundInt(record.maxCases, "maxCases", 32);
  const maxEvents = optionalBoundInt(record.maxEvents, "maxEvents", 64);
  return { runId, caseId: optionalString(record.caseId, "caseId"), maxCases, maxEvents };
}

export function parseProposalArgs(args: unknown): CanaryMcpProposalInput {
  const record = assertToolArgs("canary.submit_proposal", args);
  if (!("proposal" in record)) throw invalid("canary.submit_proposal requires proposal");
  return { proposal: record.proposal };
}

export function parseStructureArgs(args: unknown): CanaryMcpStructureInput {
  const record = assertToolArgs("canary.structure", args);
  const runId = requiredString(record.runId, "runId");
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
        description: "Run a bound-project Canary evaluation. Headless only. Does not write source.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: { caseId: { type: "string" }, headless: { type: "boolean", const: true } },
        },
      },
      {
        name: "canary.evidence",
        description: "Read bounded, untrusted evaluation evidence for a run in the bound project.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["runId"],
          properties: {
            runId: { type: "string" },
            caseId: { type: "string" },
            maxCases: { type: "integer", minimum: 1, maximum: 32 },
            maxEvents: { type: "integer", minimum: 1, maximum: 64 },
          },
        },
      },
      {
        name: "canary.structure",
        description: "Read a bounded page of the sealed project structure for a run in the bound project. Never reconstructs old runs from current source.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["runId"],
          properties: { runId: { type: "string" }, pathPrefix: { type: "string" }, offset: { type: "integer", minimum: 0, maximum: 1000000 }, edgeOffset: { type: "integer", minimum: 0, maximum: 1000000 }, unknownOffset: { type: "integer", minimum: 0, maximum: 1000000 }, changeOffset: { type: "integer", minimum: 0, maximum: 1000000 }, maxNodes: { type: "integer", minimum: 1, maximum: 200 } },
        },
      },
      {
        name: "canary.submit_proposal",
        description: "Record a host proposal as unapproved evidence. Never approves or writes source.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["proposal"],
          properties: { proposal: { type: "object" } },
        },
      },
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
