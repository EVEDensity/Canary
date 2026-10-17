import { z } from "zod";
import { projectMemoryHash } from "./project-memory.js";

export const QUALITY_MAX_RECORD_BYTES = 524_288;
export const QUALITY_MAX_REPORT_BYTES = 49_152;
export const QUALITY_MAX_DECISIONS = 32;
export const QUALITY_MAX_REPORTS = 8;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const id = z
  .string()
  .min(1)
  .max(180)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/)
  .refine((v) => v !== "." && v !== "..");
const text = z.string().min(1).max(600);
const list = <T extends z.ZodTypeAny>(item: T, max = 32) => z.array(item).max(max);
const count = z.number().int().nonnegative();
const referenceId = z.string().min(1).max(180);
const evidence = z
  .object({
    runId: id,
    kind: z.enum(["assertion", "check", "coverage", "gate"]),
    caseId: referenceId.optional(),
    executionId: referenceId.optional(),
    checkId: referenceId.optional(),
    assertionId: z.string().max(180).optional(),
    filePath: z.string().max(400).optional(),
    line: z.number().int().positive().optional(),
  })
  .strict();
const option = z
  .object({
    id,
    issueId: id,
    action: z.enum([
      "inspect-evidence",
      "repair-behavior",
      "review-contract",
      "restore-prerequisite",
      "add-validation",
    ]),
    title: text,
    rationale: text,
    prerequisites: list(text, 6),
    scope: z
      .object({ caseIds: list(referenceId, 8), checkIds: list(referenceId, 8), files: list(z.string().max(400), 8) })
      .strict(),
    expectedBenefit: text,
    benefitStatus: z.literal("hypothesis"),
    validation: list(text, 6),
    modelCalls: z.literal("depends-on-configuration"),
    executionGranted: z.literal(false),
  })
  .strict();
export const qualityAssessmentSchema = z
  .object({
    v: z.literal(1),
    kind: z.literal("canary.quality-assessment"),
    id: z.string().regex(/^assessment_[a-f0-9]{24}$/),
    contentHash: digest,
    projectId: digest,
    binding: z
      .object({
        runId: id,
        runHash: digest,
        manifestHash: digest,
        configHash: z.string().min(1).max(160).optional(),
        casesHash: z.string().min(1).max(160).optional(),
        sourceHash: z.string().min(1).max(160).optional(),
        gitCommit: z.string().max(64).optional(),
        gitDirty: z.boolean().optional(),
      })
      .strict(),
    scope: z.enum(["agent", "project", "mixed"]),
    run: z
      .object({
        status: z.enum(["completed", "failed", "cancelled"]),
        startedAt: z.string(),
        finishedAt: z.string().optional(),
      })
      .strict(),
    counts: z
      .object({
        agent: z.object({ total: count, completed: count, passed: count, failed: count }).strict(),
        checks: z.object({ total: count, passed: count, failed: count, blocked: count, skipped: count }).strict(),
        issues: count,
      })
      .strict(),
    coverage: list(
      z
        .object({
          metric: z.enum(["lines", "statements", "functions", "branches"]),
          covered: count,
          total: count,
          pct: z.number().min(0).max(100).nullable(),
        })
        .strict(),
      4,
    ),
    telemetry: z
      .object({
        latencyMs: z.number().nonnegative().nullable(),
        steps: count.nullable(),
        toolCalls: count.nullable(),
        modelTokens: z.null(),
        monetaryCost: z.null(),
      })
      .strict(),
    issues: list(
      z
        .object({
          id,
          category: text,
          priority: z.enum(["high", "medium", "low"]),
          origin: z.enum(["agent", "project", "coverage", "gate"]),
          title: text,
          observation: text,
          evidence: list(evidence, 8),
          uncertainty: list(text, 6),
          recommendedOptionId: id,
        })
        .strict(),
      16,
    ),
    options: list(option, 48),
    history: list(
      z
        .object({
          relation: z.enum(["replayOf", "candidateOf", "retryOf", "recoveryOf", "childRun"]),
          runId: id,
          integrity: z.enum(["verified", "unavailable"]),
          gitCommit: z.string().max(64).optional(),
          passed: count.optional(),
          total: count.optional(),
        })
        .strict(),
      6,
    ),
    omittedIssues: count,
    omittedHistory: count,
    limitations: list(text, 10),
    advisoryOnly: z.literal(true),
    executionGranted: z.literal(false),
  })
  .strict();
const operatorText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((v) => v.trim() === v && !/[\x00-\x1f\x7f]/.test(v), "Bounded plain operator text is required");
export const qualityDecisionInputSchema = z
  .object({
    reportHash: digest,
    expectedRevision: count,
    optionId: id,
    action: z.enum(["select", "reject"]),
    actor: operatorText(96),
    reason: operatorText(512),
  })
  .strict();
export const qualityDecisionSchema = qualityDecisionInputSchema
  .omit({ expectedRevision: true })
  .extend({
    revision: z.number().int().positive(),
    at: z.string().datetime({ offset: true }),
    executionGranted: z.literal(false),
    verificationStatus: z.literal("not-executed"),
  })
  .strict();
export const qualityRecordSchema = z
  .object({
    v: z.literal(1),
    kind: z.literal("canary.quality-decisions"),
    projectId: digest,
    runId: id,
    revision: z.number().int().positive(),
    reports: list(qualityAssessmentSchema, QUALITY_MAX_REPORTS).min(1),
    decisions: list(qualityDecisionSchema, QUALITY_MAX_DECISIONS).min(1),
    contentHash: digest,
  })
  .strict();
export type QualityAssessment = z.infer<typeof qualityAssessmentSchema>;
export type QualityDecisionInput = z.infer<typeof qualityDecisionInputSchema>;
export type QualityDecision = z.infer<typeof qualityDecisionSchema>;
export type QualityRecord = z.infer<typeof qualityRecordSchema>;
export interface QualityAssessmentView {
  v: 1;
  kind: "canary.quality-assessment-view";
  untrustedEvidence: true;
  report: QualityAssessment;
  revision: number;
  decisions: Array<QualityDecision & { stale: boolean }>;
  omittedDecisions: number;
  selections: Array<{ issueId: string; optionId: string; revision: number }>;
  limits: { decisions: number; reports: number; reached: boolean };
  executionGranted: false;
}
export const qualityContentHash = projectMemoryHash;
export function parseQualityAssessment(value: unknown): QualityAssessment {
  const parsed = qualityAssessmentSchema.parse(value);
  if (parsed.contentHash !== qualityContentHash(parsed)) throw new Error("Quality report content hash mismatch");
  const { id: _id, contentHash: _hash, ...body } = parsed;
  if (parsed.id !== `assessment_${qualityContentHash(body).slice(0, 24)}`)
    throw new Error("Quality report identity mismatch");
  const options = new Set(parsed.options.map((option) => option.id));
  if (
    options.size !== parsed.options.length ||
    new Set(parsed.issues.map((issue) => issue.id)).size !== parsed.issues.length ||
    parsed.issues.some(
      (issue) =>
        !parsed.options.some((option) => option.id === issue.recommendedOptionId && option.issueId === issue.id),
    ) ||
    parsed.options.some((option) => !parsed.issues.some((issue) => issue.id === option.issueId))
  )
    throw new Error("Quality report option references are invalid");
  return parsed;
}
export function parseQualityRecord(value: unknown): QualityRecord {
  const parsed = qualityRecordSchema.parse(value);
  if (
    parsed.contentHash !== qualityContentHash(parsed) ||
    parsed.revision !== parsed.decisions.length ||
    new Set(parsed.reports.map((report) => report.contentHash)).size !== parsed.reports.length
  )
    throw new Error("Quality decision record is corrupt");
  for (const report of parsed.reports) {
    parseQualityAssessment(report);
    if (report.projectId !== parsed.projectId || report.binding.runId !== parsed.runId)
      throw new Error("Quality report belongs to another run");
  }
  parsed.decisions.forEach((decision, index) => {
    if (
      decision.revision !== index + 1 ||
      !parsed.reports.some(
        (report) =>
          report.contentHash === decision.reportHash &&
          report.options.some((option) => option.id === decision.optionId),
      )
    )
      throw new Error("Quality decision references are invalid");
  });
  return parsed;
}
