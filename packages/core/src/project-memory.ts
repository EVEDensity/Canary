import { createHash } from "node:crypto";
import { z } from "zod";
import { isRepairTaskPath } from "./repair-task.js";

export const PROJECT_MEMORY_MAX_RECORDS = 256;
export const PROJECT_MEMORY_MAX_RECORD_BYTES = 65_536;
export const PROJECT_MEMORY_MAX_STORE_BYTES = 16_777_216;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const commit = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const identifier = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/)
  .refine((value) => value !== "." && value !== "..");
const path = z.string().refine(isRepairTaskPath, "A safe project-relative path is required");
const date = z.string().datetime({ offset: true });
const unsafeText =
  /(?:\b(?:api[_-]?key|access[_-]?token|authorization|password|passwd|secret)\s*[:=]\s*\S+|\bbearer\s+[A-Za-z0-9._~+/-]{8,}|\bsk-[A-Za-z0-9_-]{16,}|-----BEGIN [^-]*PRIVATE KEY-----|ignore\s+(?:all\s+)?(?:previous|prior|system|developer)\s+(?:instructions|messages)|exfiltrat|you\s+are\s+now\s+the\s+system)/i;
const operatorText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine(
      (value) => value.trim() === value && !/[\x00-\x1f\x7f]/.test(value) && !unsafeText.test(value),
      "Operator text must be bounded plain text without credentials or instruction injection",
    );
const unique = <T extends z.ZodTypeAny>(schema: T, max: number, min = 0) =>
  z
    .array(schema)
    .min(min)
    .max(max)
    .refine((values) => new Set(values).size === values.length, "Duplicate values are not allowed");

/** Canonical document identity. Only a top-level contentHash is excluded. */
export function projectMemoryHash(value: unknown): string {
  const canonical = (item: unknown, top = false): unknown => {
    if (Array.isArray(item)) return item.map((value) => canonical(value));
    if (item && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item)
          .filter(([key, value]) => value !== undefined && !(top && key === "contentHash"))
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, value]) => [key, canonical(value)]),
      );
    return item;
  };
  return createHash("sha256")
    .update(JSON.stringify(canonical(value, true)))
    .digest("hex");
}

export function projectMemoryId(projectId: string, receiptHash: string): string {
  return "memory_" + createHash("sha256").update(`${projectId}:${receiptHash}`).digest("hex").slice(0, 24);
}

/** Callers resolve the project root through the filesystem before hashing it. */
export function projectMemoryProjectId(canonicalProjectRoot: string): string {
  let projectRoot = canonicalProjectRoot.replaceAll("\\", "/");
  const windowsAbsolute = /^[A-Za-z]:\//.test(projectRoot);
  if (projectRoot !== "/") projectRoot = projectRoot.replace(/\/+$/, "");
  if (windowsAbsolute) projectRoot = projectRoot.toLowerCase();
  return projectMemoryHash({ projectRoot });
}

const runIdentity = z.object({ runId: identifier, commit, manifestHash: digest }).strict();
export const projectMemoryRecordSchema = z
  .object({
    v: z.literal(1),
    kind: z.literal("canary.project-memory"),
    id: z.string().regex(/^memory_[a-f0-9]{24}$/),
    projectId: digest,
    status: z.enum(["retained", "revoked"]),
    createdAt: date,
    expiresAt: date,
    operator: z
      .object({ actor: operatorText(96), reason: operatorText(512), reviewAcknowledged: z.boolean() })
      .strict(),
    source: z
      .object({ original: runIdentity, candidate: runIdentity, beforeRegression: runIdentity, receiptHash: digest })
      .strict(),
    failures: z
      .array(
        z
          .object({
            checkId: identifier,
            checkType: z.enum(["resources", "command", "process", "http", "filesystem", "docker", "agent"]),
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
            declarationHash: digest,
            paths: unique(path, 32),
          })
          .strict(),
      )
      .min(1)
      .max(16),
    regressionChecks: unique(identifier, 16, 1),
    testFiles: unique(path, 32, 1),
    scope: z
      .object({
        projectPath: z.union([z.literal("."), path]),
        files: z
          .array(z.object({ path, mode: z.enum(["100644", "100755"]), blob: commit.nullable() }).strict())
          .min(1)
          .max(256),
      })
      .strict(),
    contentHash: digest,
    revocation: z
      .object({ at: date, actor: operatorText(96), reason: operatorText(512) })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((record, context) => {
    const issue = (message: string) => context.addIssue({ code: z.ZodIssueCode.custom, message });
    if ((record.status === "revoked") !== Boolean(record.revocation))
      issue("Only revoked memory must include revocation evidence");
    if (Date.parse(record.expiresAt) <= Date.parse(record.createdAt)) issue("Expiry must follow creation");
    if (record.revocation && Date.parse(record.revocation.at) < Date.parse(record.createdAt))
      issue("Revocation cannot precede creation");
    if (new Set(record.failures.map((value) => value.checkId)).size !== record.failures.length)
      issue("Failure check identities must be unique");
    if (new Set(record.scope.files.map((value) => value.path)).size !== record.scope.files.length)
      issue("Scope paths must be unique");
    if (
      new Set([record.source.original.runId, record.source.candidate.runId, record.source.beforeRegression.runId])
        .size !== 3
    )
      issue("Memory requires three distinct retained run identities");
    if (record.source.beforeRegression.commit !== record.source.original.commit)
      issue("Regression must bind the original commit");
    if (record.id !== projectMemoryId(record.projectId, record.source.receiptHash))
      issue("Memory ID does not match project and receipt");
    if (record.contentHash !== projectMemoryHash(record)) issue("Memory content hash does not match its document");
    if (Buffer.byteLength(JSON.stringify(record)) > PROJECT_MEMORY_MAX_RECORD_BYTES)
      issue("Memory exceeds the record byte budget");
  });

export type ProjectMemoryRecord = z.infer<typeof projectMemoryRecordSchema>;
export type ProjectMemoryInput = Omit<ProjectMemoryRecord, "id" | "contentHash" | "status" | "revocation">;
export function memoryRecordValid(value: unknown): value is ProjectMemoryRecord {
  return projectMemoryRecordSchema.safeParse(value).success;
}
export function parseProjectMemoryRecord(value: unknown): ProjectMemoryRecord {
  return projectMemoryRecordSchema.parse(value);
}

const queryItem = z
  .object({
    record: projectMemoryRecordSchema,
    match: z.enum(["related", "needs-revalidation"]),
    checkIds: unique(identifier, 16, 1),
    reasons: z.array(z.string().min(1).max(1024)).max(32),
  })
  .strict();
export function projectMemoryQueryChars(items: unknown[]): number {
  return items.length ? JSON.stringify(items).length : 0;
}
export const projectMemoryQuerySchema = z
  .object({
    v: z.literal(1),
    kind: z.literal("canary.project-memory-query"),
    runId: identifier,
    projectId: digest,
    status: z.enum(["available", "unavailable"]),
    items: z.array(queryItem).max(10),
    skipped: z
      .array(z.object({ id: z.string().regex(/^memory_[a-f0-9]{24}$/), reason: z.string().min(1).max(1024) }).strict())
      .max(32),
    total: z.number().int().nonnegative().max(PROJECT_MEMORY_MAX_RECORDS).nullable(),
    omitted: z.number().int().nonnegative().max(PROJECT_MEMORY_MAX_RECORDS).nullable(),
    omittedSkipped: z.number().int().nonnegative().max(PROJECT_MEMORY_MAX_RECORDS),
    budget: z
      .object({
        maxItems: z.number().int().min(1).max(10),
        maxChars: z.number().int().min(512).max(32768),
        usedChars: z.number().int().nonnegative().max(32768),
      })
      .strict(),
    advisoryOnly: z.literal(true),
    executionGranted: z.literal(false),
    reasons: z.array(z.string().min(1).max(1024)).max(32),
  })
  .strict()
  .superRefine((query, context) => {
    const issue = (message: string) => context.addIssue({ code: z.ZodIssueCode.custom, message });
    if (
      query.budget.usedChars !== projectMemoryQueryChars(query.items) ||
      query.budget.usedChars > query.budget.maxChars ||
      query.items.length > query.budget.maxItems
    )
      issue("Query context does not match its declared budget");
    if (new Set(query.items.map((item) => item.record.id)).size !== query.items.length)
      issue("Query memory identities must be unique");
    if (query.items.some((item) => item.record.projectId !== query.projectId))
      issue("Query cannot include another project's memory");
    for (const item of query.items) {
      if (
        item.record.status !== "retained" ||
        item.checkIds.some((id) => !item.record.failures.some((failure) => failure.checkId === id))
      )
        issue("Query results require retained facts and checks in their recorded failure scope");
      if (
        item.match === "related" &&
        item.reasons.some(
          (reason) =>
            [
              "execution-context-changed",
              "related-source-changed",
              "candidate-not-established-as-ancestor",
              "failure-location-unavailable",
            ].some((code) => reason === code || reason.startsWith(code + ":")) ||
            reason.startsWith("scope-file-changed:"),
        )
      )
        issue("Known revalidation conditions cannot claim a related match");
    }
    if (query.status === "unavailable") {
      if (
        query.items.length ||
        query.total !== null ||
        query.omitted !== null ||
        query.budget.usedChars ||
        !query.reasons.length
      )
        issue("Unavailable memory queries cannot claim known results or counts");
    } else if (
      query.total === null ||
      query.omitted === null ||
      query.total < query.items.length ||
      query.omitted > query.total ||
      query.items.length + query.omitted > query.total
    )
      issue("Available memory queries require consistent known counts");
  });
export type ProjectMemoryQuery = z.infer<typeof projectMemoryQuerySchema>;
