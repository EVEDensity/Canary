import { z } from "zod";

export const CONTROLLED_BENEFIT_MAX_CASES = 64;
export const CONTROLLED_BENEFIT_MAX_TRIALS = 256;
export const CONTROLLED_BENEFIT_MIN_PAIRS = 5;

export const controlledBenefitReasonSchema = z.enum([
  "sample-limit-exceeded",
  "invalid-run-identity",
  "unfinished-run",
  "invalid-run-counters",
  "invalid-trial-identity",
  "duplicate-trial",
  "unpaired-trial",
  "empty-regression-scope",
  "empty-holdout-scope",
  "invalid-scope",
  "overlapping-scopes",
  "missing-scope-case",
  "holdout-was-not-passing",
  "missing-case-snapshot",
  "case-contract-changed",
  "unsupported-case-contract",
  "missing-assertion-result",
  "contradictory-result",
  "missing-deterministic-contract",
  "uncalibrated-judge",
  "interrupted-trial",
  "coverage-contract-unavailable",
  "hard-gate-failed",
  "too-few-pairs",
]);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const scope = z.object({ paired: count, improved: count, regressed: count, unchanged: count, missing: count }).strict();
const metric = z
  .object({
    paired: count,
    baseline: z.number().nonnegative().finite(),
    candidate: z.number().nonnegative().finite(),
    delta: z.number().finite(),
  })
  .strict()
  .nullable();

/** Descriptive observations of a frozen local evaluation contract, never execution authority. */
export const controlledBenefitSchema = z
  .object({
    v: z.literal(1),
    kind: z.literal("canary.controlled-benefit"),
    baselineRunId: z.string().min(1).max(180),
    candidateRunId: z.string().min(1).max(180),
    status: z.enum(["observed-improvement", "observed-regression", "no-observed-improvement", "insufficient"]),
    sample: z
      .object({ baseline: count, candidate: count, paired: count, deterministicPaired: count, minimum: z.literal(5) })
      .strict(),
    changes: z.object({ improved: count, regressed: count, unchanged: count, missing: count }).strict(),
    scopes: z.object({ regression: scope, holdout: scope, other: scope }).strict(),
    rates: z
      .object({
        baselinePassedPct: z.number().min(0).max(100),
        candidatePassedPct: z.number().min(0).max(100),
        deltaPercentagePoints: z.number().min(-100).max(100),
      })
      .strict()
      .nullable(),
    telemetry: z
      .object({
        latencyMs: metric,
        steps: metric,
        toolCalls: metric,
        /** Runner budget units have no currency or token denomination. */
        budgetUnits: metric,
        modelTokens: z.null(),
        monetaryCost: z.null(),
      })
      .strict(),
    comparison: z
      .object({ verdict: z.enum(["keep", "improve", "reject", "incomparable"]), comparable: z.boolean() })
      .strict(),
    uncertainty: z
      .object({
        method: z.literal("descriptive-paired-observations"),
        reasons: z.array(controlledBenefitReasonSchema).max(26),
        confidenceInterval: z.null(),
      })
      .strict(),
    interpretation: z.literal("fixed-contract-observations-not-causal-or-population-evidence"),
    executionGranted: z.literal(false),
  })
  .strict();

export type ControlledBenefit = z.infer<typeof controlledBenefitSchema>;
export type ControlledBenefitReason = z.infer<typeof controlledBenefitReasonSchema>;
