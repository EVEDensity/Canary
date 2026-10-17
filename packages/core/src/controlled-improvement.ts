import { z } from "zod";
import { isRepairTaskPath } from "./repair-task.js";
import { qualityContentHash, qualityAssessmentSchema } from "./quality-assessment.js";
import { controlledBenefitSchema } from "./controlled-benefit.js";

export const IMPROVEMENT_MAX_RECORD_BYTES = 262_144;
export const IMPROVEMENT_MAX_SESSIONS = 64;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const identifier = z
  .string()
  .min(1)
  .max(180)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/)
  .refine((v) => v !== "." && v !== "..");
const reference = z
  .string()
  .min(1)
  .max(180)
  .refine((v) => v.trim() === v && !/[\x00-\x1f\x7f]/.test(v));
const sessionId = z.string().regex(/^improvement_[a-f0-9-]{36}$/);
const path = z.string().refine(isRepairTaskPath);
const unique = <T extends z.ZodTypeAny>(schema: T, minimum: number, maximum: number) =>
  z
    .array(schema)
    .min(minimum)
    .max(maximum)
    .refine((items) => new Set(items).size === items.length);
const plain = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((v) => v.trim() === v && !/[\x00-\x1f\x7f]/.test(v));
const date = z.string().datetime({ offset: true });

/** A reviewable verification plan. Preparing it grants no execution authority. */
export const improvementPlanSchema = z
  .object({
    v: z.literal(1),
    kind: z.literal("canary.improvement-plan"),
    id: sessionId,
    projectId: digest,
    createdAt: date,
    baseline: qualityAssessmentSchema.shape.binding,
    selection: z
      .object({
        reportHash: digest,
        expectedRevision: z.number().int().positive(),
        optionId: reference,
        selectionRevision: z.number().int().positive(),
      })
      .strict(),
    scope: z
      .object({
        caseIds: unique(reference, 2, 64),
        regressionCaseIds: unique(reference, 1, 32),
        holdoutCaseIds: unique(reference, 1, 32),
        allowedPaths: unique(path, 1, 32),
        contractsHash: digest,
        trials: z.number().int().min(2).max(256),
      })
      .strict(),
    candidate: z
      .object({ configPath: path, configFileHash: digest, entry: path, entryHash: digest, inventoryHash: digest })
      .strict(),
    budget: z
      .object({
        maxRuns: z.number().int().min(1).max(3),
        maxCases: z.number().int().min(2).max(256),
        maxDurationMs: z.number().int().min(1000).max(600_000),
        maxToolCalls: z.number().int().min(0).max(10_000),
        maxLiveModelCalls: z.literal(0),
      })
      .strict(),
    success: z
      .object({
        requireRegressionImprovement: z.literal(true),
        allowRegressions: z.literal(false),
        requireHoldoutPass: z.literal(true),
        minimumPairs: z.literal(5),
      })
      .strict(),
    executionGranted: z.literal(false),
    contentHash: digest,
  })
  .strict();
export const improvementAuthorizationSchema = z
  .object({ planHash: digest, actor: plain(96), reason: plain(512) })
  .strict();
export const improvementAttemptResultSchema = z
  .object({
    status: z.enum(["completed", "blocked", "cancelled"]),
    code: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
    candidateRunId: identifier.optional(),
    candidateManifestHash: digest.optional(),
    benefit: controlledBenefitSchema.optional(),
    observed: z
      .object({
        durationMs: z.number().nonnegative(),
        cases: z.number().int().nonnegative(),
        toolCalls: z.number().int().nonnegative(),
        managedLiveModelCalls: z.literal(0),
        monetaryCost: z.null(),
      })
      .strict(),
  })
  .strict();
export const improvementAttemptSchema = z
  .object({
    index: z.number().int().min(1).max(3),
    executionRequest: improvementAuthorizationSchema,
    startedAt: date,
    finishedAt: date.optional(),
    state: z.enum(["running", "finished"]),
    result: improvementAttemptResultSchema.optional(),
  })
  .strict();
export const improvementSessionSchema = z
  .object({
    v: z.literal(1),
    kind: z.literal("canary.improvement-session"),
    plan: improvementPlanSchema,
    revision: z.number().int().min(0).max(6),
    attempts: z.array(improvementAttemptSchema).max(3),
    contentHash: digest,
  })
  .strict();
export type ImprovementPlan = z.infer<typeof improvementPlanSchema>;
export type ImprovementAuthorization = z.infer<typeof improvementAuthorizationSchema>;
export type ImprovementAttemptResult = z.infer<typeof improvementAttemptResultSchema>;
export type ImprovementAttempt = z.infer<typeof improvementAttemptSchema>;
export type ImprovementSession = z.infer<typeof improvementSessionSchema>;

export function parseImprovementPlan(value: unknown): ImprovementPlan {
  const plan = improvementPlanSchema.parse(value),
    scope = plan.scope;
  if (plan.contentHash !== qualityContentHash(plan)) throw new Error("Improvement plan hash mismatch");
  if (
    scope.regressionCaseIds.some((id) => !scope.caseIds.includes(id) || scope.holdoutCaseIds.includes(id)) ||
    scope.holdoutCaseIds.some((id) => !scope.caseIds.includes(id))
  )
    throw new Error("Improvement case scopes are inconsistent");
  if (
    scope.trials > plan.budget.maxCases ||
    !scope.allowedPaths.includes(plan.candidate.entry) ||
    plan.selection.selectionRevision > plan.selection.expectedRevision
  )
    throw new Error("Improvement scope or budget is inconsistent");
  return plan;
}
export function parseImprovementSession(value: unknown): ImprovementSession {
  const session = improvementSessionSchema.parse(value);
  parseImprovementPlan(session.plan);
  if (session.contentHash !== qualityContentHash(session)) throw new Error("Improvement session hash mismatch");
  if (session.attempts.length > session.plan.budget.maxRuns) throw new Error("Improvement attempt budget exceeded");
  let revisions = 0;
  for (const [index, attempt] of session.attempts.entries()) {
    if (
      attempt.index !== index + 1 ||
      attempt.executionRequest.planHash !== session.plan.contentHash ||
      (index < session.attempts.length - 1 && attempt.state !== "finished")
    )
      throw new Error("Improvement attempt order or authorization mismatch");
    revisions += attempt.state === "finished" ? 2 : 1;
    if (
      attempt.state === "finished"
        ? !attempt.finishedAt || !attempt.result
        : Boolean(attempt.finishedAt || attempt.result)
    )
      throw new Error("Improvement attempt is incomplete");
    const result = attempt.result;
    if (result && Boolean(result.candidateRunId) !== Boolean(result.candidateManifestHash))
      throw new Error("Improvement candidate binding is incomplete");
    if (
      result?.benefit &&
      (result.benefit.baselineRunId !== session.plan.baseline.runId ||
        result.benefit.candidateRunId !== result.candidateRunId)
    )
      throw new Error("Improvement benefit binding mismatch");
    if (result?.status === "completed" && (!result.candidateRunId || !result.benefit))
      throw new Error("Completed improvement requires candidate evidence and benefit");
  }
  if (session.revision !== revisions) throw new Error("Improvement revision mismatch");
  return session;
}
