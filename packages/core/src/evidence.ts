import { z } from "zod";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const id = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/)
  .refine((value) => value !== "." && value !== "..");
export const runLineageSchema = z
  .object({
    replayOf: id.optional(),
    candidateOf: id.optional(),
    retryOf: id.optional(),
    recoveryOf: id.optional(),
    parentManifestHash: digest.optional(),
  })
  .strict();
export const artifactManifestSchema = z
  .object({
    v: z.literal(1),
    kind: z.literal("canary.artifact-manifest"),
    runId: id,
    state: z.enum(["partial", "sealed", "recovered"]),
    revision: z.number().int().positive(),
    createdAt: z.string(),
    updatedAt: z.string(),
    previousManifestHash: digest.optional(),
    lineage: runLineageSchema,
    files: z.array(z.object({ path: id, bytes: z.number().int().nonnegative(), sha256: digest }).strict()),
    privacy: z.object({ policy: z.literal("redact-v1"), scanned: z.boolean() }).strict(),
  })
  .strict();
export type ArtifactManifest = z.infer<typeof artifactManifestSchema>;
export type RunLineage = z.infer<typeof runLineageSchema>;

export interface RunEvidence {
  v: 1;
  privacyFailure?: boolean;
  lineage: RunLineage;
  reproduction: {
    configHash: string;
    casesHash: string;
    sourceHash: string;
    node: string;
    platform: string;
    arch: string;
    gitCommit?: string;
    gitDirty?: boolean;
    projectPath?: string;
    toolVersions?: Record<string, string>;
    commandTools?: Record<string, { kind: "canary-script"; path: string; sha256: string }>;
    lockfiles: Record<string, string>;
    environmentHash: string;
    environmentNames: string[];
    clock?: string;
    seed?: number;
    mode: "recorded" | "context-clock-random";
  };
  conclusionHash?: string;
}

export interface ArtifactOptions {
  reproducibility?: { clock?: string; seed?: number; envAllowlist?: string[] };
  retention?: { maxRuns?: number; maxAgeDays?: number; maxBytes?: number };
}
