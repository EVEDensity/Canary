import { isAbsolute } from "node:path";
import { z } from "zod";
import type { RunSnapshot } from "./types.js";

/** R0 v1. These codes apply to run --ci; legacy commands retain their codes. */
export const CLI_EXIT = {
  success: 0,
  checkFailed: 1,
  configuration: 2,
  interrupted: 3,
  environment: 4,
  artifact: 5,
  policy: 6,
  internal: 10,
} as const;
export const cliExitCodeSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(10),
]);
export type CliExitCode = z.infer<typeof cliExitCodeSchema>;
export const evidenceStatusSchema = z.enum(["verified", "declared", "blocked", "excluded"]);
export type EvidenceStatus = z.infer<typeof evidenceStatusSchema>;
const absolutePath = z.string().min(1).refine(isAbsolute, "Expected an absolute path on the executing platform");
export const projectContextSchema = z
  .object({
    v: z.literal(1),
    invocationRoot: absolutePath,
    projectRoot: absolutePath,
    configRoot: absolutePath,
    configFile: absolutePath,
    installRoot: absolutePath.optional(),
    artifactRoot: absolutePath,
    source: z.enum(["config", "walk", "cwd"]),
  })
  .strict();
export const pathsSnapshotSchema = projectContextSchema.extend({ kind: z.literal("canary.paths") });
export const cliIssueSchema = z
  .object({
    code: z.string().min(1),
    severity: z.enum(["error", "warning"]),
    message: z.string(),
    suggestion: z.string().min(1),
  })
  .strict();
export type CliIssue = z.infer<typeof cliIssueSchema>;
export const versionSnapshotSchema = z
  .object({
    v: z.literal(1),
    kind: z.literal("canary.version"),
    canaryVersion: z.string().min(1),
    nodeVersion: z.string().min(1),
  })
  .strict();
export const doctorSnapshotSchema = projectContextSchema.extend({
  kind: z.literal("canary.doctor"),
  canaryVersion: z.string(),
  nodeVersion: z.string(),
  pnpmVersion: z.string().nullable(),
  launcher: absolutePath.nullable(),
  metadataStatus: z.enum(["missing", "valid", "invalid"]),
  exporter: z.object({ enabled: z.literal(false), default: z.literal("disabled") }).strict(),
  localFirst: z.literal(true),
  exitCode: cliExitCodeSchema,
  issues: z.array(cliIssueSchema),
  problems: z.array(z.string()),
  suggestions: z.array(z.string()),
});
export const ciResultSchema = z
  .object({
    v: z.literal(1),
    kind: z.literal("canary.ci"),
    mode: z.literal("ci"),
    context: projectContextSchema,
    exitCode: cliExitCodeSchema,
    outcome: z.enum(["passed", "failed", "interrupted", "error"]),
    runId: z.string().nullable(),
    artifactPath: absolutePath.nullable(),
    summary: z
      .object({
        total: z.number().int().nonnegative(),
        passed: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
      })
      .strict(),
    issues: z.array(cliIssueSchema),
    selection: z.object({ requested: z.enum(["full", "affected"]), mode: z.enum(["full", "reduced"]), planned: z.number().int().nonnegative(), selected: z.number().int().nonnegative(), omitted: z.number().int().nonnegative(), fallbackReasons: z.array(z.string()) }).strict().optional(),
    runtime: versionSnapshotSchema,
    capabilities: z
      .object({ scope: z.enum(["configured-agent-cases", "project-checks"]), web: z.literal(false), automaticExport: z.literal(false) })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const expected =
      value.exitCode === 0
        ? "passed"
        : value.exitCode === 1
          ? "failed"
          : value.exitCode === 3
            ? "interrupted"
            : "error";
    if (value.outcome !== expected)
      context.addIssue({ code: "custom", path: ["outcome"], message: "Outcome does not match exitCode" });
    if (value.summary.passed + value.summary.failed > value.summary.total)
      context.addIssue({ code: "custom", path: ["summary"], message: "Counts exceed total" });
    if (value.selection && value.selection.selected + value.selection.omitted !== value.selection.planned)
      context.addIssue({ code: "custom", path: ["selection"], message: "Selection counts do not match the original plan" });
  });
export type CiResult = z.infer<typeof ciResultSchema>;

/** Deterministic precedence; expected timeout assertions can still pass. */
export function ciExitCodeForRun(snapshot: RunSnapshot, legacyExitCode: number): CliExitCode {
  if (
    snapshot.evidence?.privacyFailure ||
    (snapshot.gate?.hardGate?.policyViolations ?? 0) > 0 ||
    snapshot.gate?.failureCategory === "policy_violation" ||
    snapshot.results.some((r) => !r.passed && r.failureCategory === "policy_violation")
  )
    return CLI_EXIT.policy;
  if (
    snapshot.status === "cancelled" ||
    snapshot.results.some(
      (r) =>
        !r.passed &&
        (["timeout", "cancelled", "budget_exceeded"].includes(r.failureCategory ?? "") ||
          ["timeout", "cancelled", "budget_exceeded"].includes(r.trajectory?.termination ?? "")),
    )
  )
    return CLI_EXIT.interrupted;
  return legacyExitCode !== 0 || snapshot.status !== "completed" || snapshot.results.some((r) => !r.passed)
    ? CLI_EXIT.checkFailed
    : CLI_EXIT.success;
}
