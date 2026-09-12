import { z, ZodError } from "zod";

export class SchemaValidationError extends Error {
  readonly issues: ZodError["issues"];
  constructor(context: string, error: ZodError) {
    const details = error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
    super(`${context}: ${details}`);
    this.name = "SchemaValidationError";
    this.issues = error.issues;
  }
}

function parsed<T>(context: string, result: z.SafeParseReturnType<unknown, T>): T {
  if (!result.success) throw new SchemaValidationError(context, result.error);
  return result.data;
}

const adapterSchema = z.enum(["function", "http", "mcp"]);
const coverageStatusSchema = z.enum(["provisional", "final", "partial", "unavailable"]);
const runStatusSchema = z.enum(["idle", "running", "completed", "failed"]);
const reporterSchema = z.enum(["json", "markdown", "junit"]);

export const coverageMetricSchema = z.object({
  covered: z.number(),
  total: z.number(),
  pct: z.number(),
});

export const canaryConfigSchema = z.object({
  agent: z.object({
    adapter: adapterSchema,
    entry: z.string().min(1),
    export: z.string().min(1).optional(),
  }),
  cases: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  coverage: z.object({
    include: z.array(z.string().min(1)).min(1),
    exclude: z.array(z.string()).optional(),
    lines: z.number().min(0).max(100).optional(),
    branches: z.number().min(0).max(100).optional(),
    functions: z.number().min(0).max(100).optional(),
    statements: z.number().min(0).max(100).optional(),
    featureChains: z.record(z.number().min(0).max(100)).optional(),
  }),
  features: z.array(z.object({
    id: z.string().min(1),
    name: z.string().optional(),
    description: z.string().optional(),
    files: z.array(z.string().min(1)).min(1),
    lines: z.array(z.object({ start: z.number(), end: z.number() })).optional(),
    tags: z.array(z.string()).optional(),
  })).optional(),
  runtime: z.object({
    timeoutMs: z.number().positive().optional(),
    maxSteps: z.number().int().positive().optional(),
    maxToolCalls: z.number().int().nonnegative().optional(),
    maxBudget: z.number().nonnegative().optional(),
  }).optional(),
  reporters: z.array(reporterSchema).optional(),
  web: z.object({
    enabled: z.boolean().optional(),
    host: z.string().min(1).optional(),
    port: z.number().int().nonnegative().optional(),
    open: z.boolean().optional(),
  }).optional(),
}).strict();

export const testCaseSchema = z.object({
  id: z.string().min(1),
  input: z.any(),
  expectedFeatures: z.array(z.string()).optional(),
  assertions: z.array(z.object({ type: z.string().min(1) }).passthrough()).optional(),
  options: z.object({
    timeoutMs: z.number().positive().optional(),
    maxSteps: z.number().int().positive().optional(),
    maxToolCalls: z.number().int().nonnegative().optional(),
    maxBudget: z.number().nonnegative().optional(),
  }).optional(),
}).strict().refine((value) => value.input !== undefined, { message: "input is required", path: ["input"] });

export const trajectoryEventSchema = z.object({
  type: z.string().min(1),
  timestamp: z.string().optional(),
}).passthrough();

export const coverageScriptSchema = z.object({
  scriptId: z.string().optional(),
  url: z.string().optional(),
  source: z.string().optional(),
  functions: z.array(z.any()).default([]),
}).passthrough();

export const childMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready") }),
  z.object({ type: z.literal("event"), event: trajectoryEventSchema }),
  z.object({ type: z.literal("result"), value: z.unknown() }),
  z.object({ type: z.literal("error"), error: z.string() }),
  z.object({
    type: z.literal("coverage"),
    scripts: z.array(coverageScriptSchema),
    partial: z.boolean().optional(),
    provisional: z.boolean().optional(),
  }),
]);

export const coverageSummarySchema = z.object({
  runId: z.string().min(1),
  sourceHash: z.string().min(1),
  status: coverageStatusSchema,
  lines: coverageMetricSchema,
  statements: coverageMetricSchema,
  functions: coverageMetricSchema,
  branches: coverageMetricSchema,
  files: z.array(z.unknown()).optional(),
  featureChains: z.array(z.unknown()).default([]),
}).passthrough();

export const evalResultSchema = z.object({
  runId: z.string().min(1),
  executionId: z.string().min(1),
  caseId: z.string().min(1),
  passed: z.boolean(),
  assertions: z.array(z.object({
    id: z.string(),
    passed: z.boolean(),
    message: z.string().optional(),
    details: z.unknown().optional(),
  }).passthrough()),
  coverage: coverageSummarySchema,
  output: z.unknown().optional(),
  metrics: z.object({
    latencyMs: z.number(),
    steps: z.number(),
    toolCalls: z.number(),
    budgetUsed: z.number().optional(),
  }).passthrough().optional(),
  failureCategory: z.string().optional(),
  trajectoryId: z.string().optional(),
  trajectory: z.unknown().optional(),
  createdAt: z.string().optional(),
}).passthrough();

export const runSnapshotSchema = z.object({
  runId: z.string().min(1),
  status: runStatusSchema,
  startedAt: z.string().min(1),
  finishedAt: z.string().optional(),
  totalCases: z.number(),
  completedCases: z.number(),
  passedCases: z.number(),
  results: z.array(evalResultSchema).default([]),
  coverage: coverageSummarySchema.optional(),
  events: z.array(z.unknown()).default([]),
  improvements: z.array(z.unknown()).optional(),
  gate: z.unknown().optional(),
  replayOf: z.string().optional(),
}).passthrough();

export const replayRequestSchema = z.object({
  caseId: z.string().min(1).optional(),
}).strict();

export const replayResponseSchema = z.object({
  sourceRunId: z.string().min(1),
  command: z.string().min(1),
  mode: z.enum(["command", "execution"]),
  replayRunId: z.string().optional(),
  events: z.number().int().nonnegative(),
});

export const reportFormatSchema = z.enum(["json", "markdown", "junit"]);

export function invalidInput(context: string, message: string): never {
  throw new SchemaValidationError(context, new ZodError([{ code: "custom", path: [], message }]));
}

export function parseCanaryConfig(input: unknown) {
  return parsed("CanaryConfig", canaryConfigSchema.safeParse(input));
}

export function parseTestCase(input: unknown, context = "TestCase") {
  return parsed(context, testCaseSchema.safeParse(input));
}

export function parseChildMessage(input: unknown): z.infer<typeof childMessageSchema> {
  return parsed("IPC payload", childMessageSchema.safeParse(input));
}

export function parseCoverageSummary(input: unknown, context = "CoverageSummary") {
  return parsed(context, coverageSummarySchema.safeParse(input));
}

export function parseRunSnapshot(input: unknown, context = "RunSnapshot") {
  return parsed(context, runSnapshotSchema.safeParse(input));
}

export function parseReplayRequest(input: unknown) {
  return parsed("POST /api/runs/:runId/replay", replayRequestSchema.safeParse(input ?? {}));
}

export function parseReplayResponse(input: unknown) {
  return parsed("replay response", replayResponseSchema.safeParse(input));
}

export function parseReportFormat(input: unknown) {
  return parsed("report format", reportFormatSchema.safeParse(input));
}
