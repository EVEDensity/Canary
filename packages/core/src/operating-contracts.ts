import { z } from "zod";
export const PROFILE_LIMITS = {
  samples: 5,
  entries: 20_000,
  depth: 48,
  sourceFiles: 5_000,
  sourceBytes: 67_108_864,
  artifactBytes: 134_217_728,
  fileBytes: 16_777_216,
  elapsedMs: 60_000,
} as const;
const digest = z.string().regex(/^[a-f0-9]{64}$/),
  nonnegative = z.number().finite().nonnegative();
const stages = ["discovery", "structure-build", "evidence-verify", "quality-brief", "project-memory"] as const;
export const profileStageSchema = z
  .object({
    id: z.enum(stages),
    status: z.enum(["measured", "unavailable", "blocked"]),
    code: z.string().regex(/^PROFILE_[A-Z_]+$/),
    nextAction: z.string().min(1).max(1024),
    counts: z.record(z.number().int().nonnegative()).optional(),
    bytes: z.number().int().nonnegative().optional(),
    inputHash: digest.optional(),
    consistent: z.boolean(),
    timingMs: z
      .object({
        samples: z.array(nonnegative).max(5),
        min: nonnegative.nullable(),
        median: nonnegative.nullable(),
        max: nonnegative.nullable(),
      })
      .strict(),
  })
  .strict();
export const projectProfileSchema = z
  .object({
    v: z.literal(1),
    kind: z.literal("canary.profile"),
    runId: z.string().min(1).max(160),
    requestedSamples: z.number().int().min(1).max(5),
    readOnly: z.literal(true),
    executionGranted: z.literal(false),
    environment: z.object({ node: z.string(), platform: z.string(), arch: z.string() }).strict(),
    limits: z
      .object({
        samples: z.literal(5),
        entries: z.literal(20_000),
        depth: z.literal(48),
        sourceFiles: z.literal(5_000),
        sourceBytes: z.literal(67_108_864),
        artifactBytes: z.literal(134_217_728),
        fileBytes: z.literal(16_777_216),
        elapsedMs: z.literal(60_000),
      })
      .strict(),
    stages: z.array(profileStageSchema).length(5),
    limitations: z.array(z.string().max(1024)).min(1).max(16),
  })
  .strict()
  .refine(
    (value) => value.stages.every((stage, index) => stage.id === stages[index]),
    "Profile stages must remain ordered and complete",
  );
export const improvementRecoveryViewSchema = z
  .object({
    v: z.literal(1),
    kind: z.literal("canary.improvement-recovery"),
    sessionId: z.string().regex(/^improvement_[a-f0-9-]{36}$/),
    sessionHash: digest,
    planHash: digest,
    revision: z.number().int().min(0).max(14),
    lockHash: z.union([digest, z.literal("absent")]),
    status: z.enum(["ready", "active", "not-needed", "blocked"]),
    code: z.string().regex(/^IMPROVEMENT_[A-Z_]+$/),
    nextAction: z.string().max(1024),
    executionGranted: z.literal(false),
  })
  .strict();
export type ProfileStage = z.infer<typeof profileStageSchema>;
export type ProjectProfile = z.infer<typeof projectProfileSchema>;
