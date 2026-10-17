import { z } from "zod";
import { qualityContentHash } from "./quality-assessment.js";
export const ARCHIVE_LIMITS = {
  files: 8192,
  directories: 4096,
  runs: 512,
  fileBytes: 33_554_432,
  totalBytes: 268_435_456,
  manifestBytes: 2_097_152,
} as const;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const path = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (p) =>
      !p.includes("\\") &&
      !p.startsWith("/") &&
      !p.includes(":") &&
      p.split("/").every((part) => part !== "." && part !== ".." && /^[A-Za-z0-9_.-]+$/.test(part)),
  );
const plain = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((v) => v.trim() === v && !/[\x00-\x1f\x7f]/.test(v));
const file = z.object({ path, bytes: z.number().int().min(0).max(ARCHIVE_LIMITS.fileBytes), sha256: digest }).strict();
export const archiveAuthorizationSchema = z.object({ planHash: digest, actor: plain(96), reason: plain(512) }).strict();
const planBase = {
  v: z.literal(1),
  kind: z.literal("canary.archive-plan"),
  projectId: digest,
  targetHash: digest,
  runs: z.number().int().min(1).max(ARCHIVE_LIMITS.runs),
  files: z.number().int().min(1).max(ARCHIVE_LIMITS.files),
  bytes: z.number().int().nonnegative().max(ARCHIVE_LIMITS.totalBytes),
  executionGranted: z.literal(false),
  contentHash: digest,
};
export const archivePlanSchema = z.discriminatedUnion("action", [
  z
    .object({
      ...planBase,
      action: z.literal("create"),
      mode: z.enum(["copy", "rotate"]),
      snapshotHash: digest,
      qualityRecords: z.number().int().min(0).max(128),
      improvementSessions: z.number().int().min(0).max(64),
    })
    .strict(),
  z
    .object({
      ...planBase,
      action: z.literal("restore"),
      archivePathHash: digest,
      archiveHash: digest,
      targetState: z.enum(["empty", "missing"]),
    })
    .strict(),
]);
export function parseArchivePlan(value: unknown) {
  const result = archivePlanSchema.parse(value);
  if (result.contentHash !== qualityContentHash(result)) throw Error("Archive plan identity mismatch");
  return result;
}
export const archiveManifestSchema = z
  .object({
    v: z.literal(1),
    kind: z.literal("canary.evidence-archive"),
    id: z.string().uuid(),
    createdAt: z.string().datetime({ offset: true }),
    projectId: digest,
    planHash: digest,
    actor: plain(96),
    reason: plain(512),
    mode: z.enum(["copy", "rotate"]),
    directories: z.array(path).max(ARCHIVE_LIMITS.directories),
    files: z.array(file).min(1).max(ARCHIVE_LIMITS.files),
    runIds: z
      .array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/))
      .min(1)
      .max(ARCHIVE_LIMITS.runs),
    qualityRecords: z.number().int().nonnegative(),
    improvementSessions: z.number().int().min(0).max(64),
    contentHash: digest,
  })
  .strict();
export type EvidenceArchiveManifest = z.infer<typeof archiveManifestSchema>;
export function parseArchiveManifest(value: unknown): EvidenceArchiveManifest {
  const m = archiveManifestSchema.parse(value);
  if (
    m.contentHash !== qualityContentHash(m) ||
    new Set(m.files.map((f) => f.path)).size !== m.files.length ||
    new Set(m.directories).size !== m.directories.length ||
    new Set(m.runIds).size !== m.runIds.length ||
    m.files.reduce((n, f) => n + f.bytes, 0) > ARCHIVE_LIMITS.totalBytes
  )
    throw Error("Invalid archive identity or budget");
  const dirs = new Set(m.directories),
    files = new Set(m.files.map((f) => f.path));
  for (const entry of [...m.directories, ...files]) {
    const parts = entry.split("/");
    parts.pop();
    if ((parts.length && !dirs.has(parts.join("/"))) || (dirs.has(entry) && files.has(entry)))
      throw Error("Invalid archive hierarchy");
  }
  return m;
}
