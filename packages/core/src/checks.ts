import { z } from "zod";

const base = {
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/),
  version: z.literal(1).default(1),
  required: z.boolean().default(true),
  platforms: z
    .array(z.enum(["win32", "linux", "darwin"]))
    .nonempty()
    .optional(),
  dependsOn: z.array(z.string()).default([]),
  cwd: z.string().default("."),
  timeoutMs: z.number().int().positive().max(3_600_000).default(60_000),
  envAllowlist: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)).default([]),
  impact: z.object({
    paths: z.array(z.string().min(1).max(256).refine((path) => !path.startsWith("/") && !path.includes("..") && !path.includes("\\"), "Impact paths must be project-relative globs")).nonempty().max(64).optional(),
    always: z.boolean().optional(),
  }).strict().optional(),
};
const command = { command: z.string().min(1), args: z.array(z.string()).default([]) };
export const projectCheckSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("resources"), minFreeMemoryMb: z.number().nonnegative().optional(), minFreeDiskMb: z.number().nonnegative().optional() }).strict(),
  z.object({ ...base, type: z.literal("command"), ...command, expectedExit: z.number().int().default(0) }).strict(),
  z.object({ ...base, type: z.literal("process"), ...command, readyText: z.string().min(1).max(1024) }).strict(),
  z
    .object({
      ...base,
      type: z.literal("http"),
      url: z.string().url(),
      allowOutbound: z.boolean().default(false),
      expectedStatus: z.number().int().min(100).max(599).default(200),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("filesystem"),
      path: z.string().min(1),
      expectation: z.enum(["file", "directory", "absent"]).default("file"),
      sha256: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("docker"),
      container: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/),
      expectedState: z.enum(["running", "exited"]).default("running"),
    })
    .strict(),
  z.object({ ...base, type: z.literal("agent"), config: z.string().min(1) }).strict(),
]);
export const projectChecksConfigSchema = z
  .object({
    kind: z.literal("canary.project"),
    version: z.literal(1),
    budgetMs: z.number().int().positive().max(86_400_000).default(600_000),
    checks: z.array(projectCheckSchema).min(1),
    reproduction: z.object({
      requiredEnvironment: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)).default([]),
      services: z.array(z.string().min(1).max(256)).default([]),
      data: z.array(z.string().min(1).max(256)).default([]),
    }).strict().optional(),
    web: z.object({ enabled: z.boolean().optional(), host: z.enum(["127.0.0.1", "::1", "localhost"]).optional(), port: z.number().int().min(0).max(65535).optional(), open: z.boolean().optional() }).strict().optional(),
  })
  .strict()
  .superRefine((config, ctx) => {
    const seen = new Set<string>();
    for (const check of config.checks) {
      if (seen.has(check.id)) ctx.addIssue({ code: "custom", message: "Duplicate check ID" });
      // Declaration order is the execution order, so forward edges/cycles are rejected.
      if (check.dependsOn.some((id) => !seen.has(id)))
        ctx.addIssue({ code: "custom", message: "Dependencies must refer to preceding checks" });
      seen.add(check.id);
      if (check.type === "filesystem" && check.sha256 && check.expectation !== "file")
        ctx.addIssue({ code: "custom", message: "Hashes require a file expectation" });
    }
    if (!config.checks.some((check) => check.required))
      ctx.addIssue({ code: "custom", message: "At least one required check is necessary" });
  });
export type ProjectCheck = z.infer<typeof projectCheckSchema>;
export type ProjectChecksConfig = z.infer<typeof projectChecksConfigSchema>;
export interface ProjectCheckSelection {
  requested: "full" | "affected";
  mode: "full" | "reduced";
  planned: number;
  selected: number;
  omitted: number;
  fallbackReasons: string[];
  omittedChecks: Array<{ id: string; reason: string }>;
}
export function defineProjectConfig(input: z.input<typeof projectChecksConfigSchema>): ProjectChecksConfig {
  return projectChecksConfigSchema.parse(input);
}
export interface ProjectCheckResult {
  /** Recorded declarations; absent in historical reports. */
  dependsOn?: string[];
  id: string;
  type: ProjectCheck["type"];
  version: 1;
  required: boolean;
  status: "passed" | "failed" | "blocked" | "excluded";
  evidence: "verified" | "blocked" | "excluded";
  exitCode: number;
  category:
    | "none"
    | "assertion"
    | "configuration"
    | "timeout"
    | "cancelled"
    | "budget"
    | "environment"
    | "artifact"
    | "policy"
    | "dependency"
    | "platform"
    | "internal";
  retryable: boolean;
  durationMs: number;
  cwd: string;
  envAllowlist: string[];
  command?: string;
  args?: string[];
  processExit?: number | null;
  httpStatus?: number;
  observations?: { freeMemoryMb: number; freeDiskMb: number };
  stdout?: string;
  stderr?: string;
  outputTruncated?: boolean;
  outputEvidence?: { stdout: string[]; stderr: string[]; policy: "bounded-redacted-lines-v1" };
  childRun?: { runId: string; artifactPath: string; manifestHash: string };
}
