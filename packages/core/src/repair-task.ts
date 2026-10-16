import { z } from "zod";

export const REPAIR_TASK_BUNDLE_MAX_BYTES = 65_536;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const identifier = z
  .string()
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/)
  .refine((value) => value !== "." && value !== "..");

/** A declaration of project scope, never filesystem access or execution authority. */
export function isRepairTaskPath(value: string): boolean {
  if (!value || value.length > 256 || value.trim() !== value || /[\\:*?"<>|\[\]{}\x00-\x1f\x7f]/.test(value))
    return false;
  return value
    .split("/")
    .every(
      (part) =>
        Boolean(part) &&
        part !== "." &&
        part !== ".." &&
        !/[. ]$/.test(part) &&
        !/^(?:\.git|\.canary|node_modules|\.ssh|\.aws|\.azure|\.gnupg)$/i.test(part) &&
        !/^\.env(?:\.|$)/i.test(part) &&
        !/\.(?:env|pem|key|p12|pfx|jks|keystore)$/i.test(part) &&
        !/^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)(?:\.|$)/i.test(part) &&
        !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    );
}
const path = z.string().refine(isRepairTaskPath, "A safe canonical project-relative path is required");
const strings = z.array(z.string().min(1).max(1024)).max(32);
const failure = z
  .object({
    checkId: identifier,
    status: z.enum(["failed", "blocked"]),
    category: z.enum([
      "none",
      "assertion",
      "configuration",
      "timeout",
      "cancelled",
      "budget",
      "environment",
      "artifact",
      "policy",
      "dependency",
      "platform",
      "internal",
    ]),
    originalError: z
      .object({ stdout: z.string().max(1024), stderr: z.string().max(1024), truncated: z.boolean() })
      .strict(),
    locations: z
      .array(
        z
          .object({
            path,
            line: z.number().int().positive(),
            column: z.number().int().positive().optional(),
            mapping: z.literal("path-line"),
          })
          .strict(),
      )
      .max(16),
    sourceMapping: z.enum(["path-line", "missing"]),
    rootCause: z.object({ status: z.enum(["unknown", "hypothesis"]), reason: z.string().min(1).max(1024) }).strict(),
  })
  .strict();
const command = z
  .object({
    checkId: identifier,
    argv: z.array(z.string().min(1).max(256)).min(1).max(8),
    intent: z.enum(["inspect-reproduction", "rerun-after-authorization"]),
    requiresExecutionGrant: z.boolean(),
  })
  .strict();
export const repairTaskSchema = z
  .object({
    v: z.literal(1),
    kind: z.literal("canary.repair-task"),
    taskId: z.string().regex(/^task_[a-f0-9]{24}$/),
    source: z
      .object({
        runId: identifier,
        manifestHash: digest,
        commit: z
          .string()
          .regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
          .optional(),
        sourceHash: digest.optional(),
        configHash: digest,
        projectPath: path.optional(),
        executionSourceHash: digest.optional(),
      })
      .strict(),
    selectedChecks: z.array(identifier).min(1).max(16),
    reproductionChecks: z.array(identifier).min(1).max(1024),
    originalChecks: z
      .array(
        z
          .object({
            id: identifier,
            type: z.enum(["resources", "command", "process", "http", "filesystem", "docker", "agent"]),
            required: z.boolean(),
            definitionHash: digest,
          })
          .strict(),
      )
      .min(1)
      .max(1024),
    scope: z.object({ allowedPaths: z.array(path).max(32), status: z.enum(["declared", "unspecified"]) }).strict(),
    failures: z.array(failure).min(1).max(16),
    requirements: z
      .object({
        environmentNames: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)).max(128),
        services: strings,
        data: strings,
      })
      .strict(),
    runtime: z
      .object({
        node: z.string().min(1).max(128),
        platform: z.string().min(1).max(64),
        arch: z.string().min(1).max(64),
        toolVersions: z
          .record(z.string().min(1).max(128))
          .refine(
            (value) =>
              Object.keys(value).length <= 32 && Object.keys(value).every((key) => /^[A-Za-z0-9_.-]{1,64}$/.test(key)),
          ),
        lockfiles: z
          .record(digest)
          .refine((value) => Object.keys(value).length <= 32 && Object.keys(value).every(isRepairTaskPath)),
      })
      .strict(),
    acceptance: z
      .object({
        preserveOriginalChecks: z.literal(true),
        requireRegression: z.literal(true),
        requireSourceIdentity: z.literal(true),
        noWeakenedTests: z.literal(true),
      })
      .strict(),
    executionGranted: z.literal(false),
    blockers: strings,
    limitations: strings,
    commands: z.array(command).min(2).max(32),
  })
  .strict()
  .superRefine((task, context) => {
    const issue = (message: string) => context.addIssue({ code: "custom", message });
    const originals = task.originalChecks.map((check) => check.id);
    if (
      new Set(task.selectedChecks).size !== task.selectedChecks.length ||
      new Set(originals).size !== originals.length ||
      !task.selectedChecks.every((id) => originals.includes(id)) ||
      JSON.stringify(task.failures.map((item) => item.checkId)) !== JSON.stringify(task.selectedChecks)
    )
      issue(
        "Selected checks must retain original declarations and exactly matching failure identities in selection order",
      );
    if (
      new Set(task.reproductionChecks).size !== task.reproductionChecks.length ||
      !task.selectedChecks.every((id) => task.reproductionChecks.includes(id)) ||
      JSON.stringify(originals.filter((id) => task.reproductionChecks.includes(id))) !==
        JSON.stringify(task.reproductionChecks)
    )
      issue(
        "Reproduction checks must include each selected check and unique prerequisites in original declaration order",
      );
    if (
      new Set(task.scope.allowedPaths).size !== task.scope.allowedPaths.length ||
      (task.scope.status === "declared") !== task.scope.allowedPaths.length > 0
    )
      issue("Declared scope must contain unique paths; unspecified scope must be empty");
    if (task.scope.status === "unspecified" && !task.blockers.includes("Repair scope has not been declared."))
      issue("Missing repair scope must remain blocked");
    if (task.failures.some((item) => (item.sourceMapping === "path-line") !== item.locations.length > 0))
      issue("Source mapping must describe actual retained locations");
    if (task.commands.length !== task.selectedChecks.length * 2)
      issue("Each check needs exactly one inspection and one authorized rerun command");
    for (const id of task.selectedChecks) {
      const inspect = task.commands.filter((item) => item.checkId === id && item.intent === "inspect-reproduction");
      const rerun = task.commands.filter((item) => item.checkId === id && item.intent === "rerun-after-authorization");
      if (
        inspect.length !== 1 ||
        inspect[0]!.requiresExecutionGrant ||
        JSON.stringify(inspect[0]!.argv) !== JSON.stringify(["canary", "reproduce", task.source.runId, "--check", id])
      )
        issue("Inspection command must be a fixed nonexecuting Canary invocation");
      if (
        rerun.length !== 1 ||
        !rerun[0]!.requiresExecutionGrant ||
        JSON.stringify(rerun[0]!.argv) !== JSON.stringify(["canary", "run", "--ci"])
      )
        issue("Rerun command requires separate authorization and fixed Canary arguments");
    }
  });
export type RepairTask = z.infer<typeof repairTaskSchema>;
export const repairTaskBundleSchema = z
  .object({
    v: z.literal(1),
    kind: z.literal("canary.repair-task-bundle"),
    task: repairTaskSchema,
    guide: z.string().min(1).max(8192),
    manifest: z
      .array(
        z
          .object({ path: z.enum(["task.json", "TASK.md"]), bytes: z.number().int().nonnegative(), sha256: digest })
          .strict(),
      )
      .length(2),
  })
  .strict()
  .superRefine((bundle, context) => {
    if (new Set(bundle.manifest.map((entry) => entry.path)).size !== 2)
      context.addIssue({ code: "custom", message: "Manifest requires exactly task.json and TASK.md" });
  });
export type RepairTaskBundle = z.infer<typeof repairTaskBundleSchema>;
