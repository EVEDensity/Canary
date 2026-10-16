import { z } from "zod";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const commit = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const identity = z.object({ runId: z.string().min(1), commit, manifestHash: digest }).passthrough();
const sourceFingerprint = z.object({
  commit,
  indexHash: digest,
  trackedStatusHash: digest,
  sourceHash: digest,
  // Older unsuccessful receipts remain readable. A verified claim requires this
  // proof too, because source inventory deliberately excludes some tracked inputs.
  trackedFilesHash: digest.optional(),
}).strict();
const overlay = z.object({ path: z.string().min(1), hash: digest }).strict();
const executionSource = z.object({
  v: z.literal(1), kind: z.literal("canary.execution-source"), runId: z.string().min(1),
  status: z.enum(["unchanged", "changed", "unavailable"]), projectPath: z.string().optional(),
  before: sourceFingerprint.optional(), after: sourceFingerprint.optional(),
}).strict();
const repairReceipt = z.object({
  v: z.literal(1), kind: z.literal("canary.repair-verification"),
  outcome: z.enum(["verified", "evidence-insufficient", "prepared", "blocked"]),
  original: identity, candidate: identity,
  regressionChecks: z.array(z.string().min(1)).min(1), testFiles: z.array(z.string().min(1)).min(1),
  executed: z.boolean(), reasons: z.array(z.string()),
  reviewRequired: z.boolean().optional(),
  executionSources: z.object({ original: executionSource.optional(), candidate: executionSource.optional() }).strict().optional(),
  beforeRegression: identity.extend({
    sourceUnchanged: z.boolean().optional(),
    executionSource: sourceFingerprint.optional(),
    observedSource: sourceFingerprint.optional(),
    testOverlay: z.array(overlay).optional(),
  }).optional(),
}).passthrough();
export const changeVerificationSchema = z.object({
  v: z.literal(1), kind: z.literal("canary.change-verification"), runId: z.string().min(1),
  baseline: commit, commit, manifestHash: digest,
  files: z.array(z.object({ path: z.string(), behavior: z.string().optional() }).passthrough()),
  contracts: z.array(z.object({ id: z.string(), status: z.enum(["verified", "failed", "unknown"]) }).passthrough()),
}).passthrough();
const reproductionReceipt = z.object({
  v: z.literal(1), kind: z.literal("canary.reproduction-result"),
  sourceRunId: z.string().min(1), sourceManifestHash: digest, runId: z.string().min(1),
  outcome: z.enum(["blocked", "source-changed", "not-reproduced", "reproduced", "failure-observed"]),
  executed: z.boolean(), sourceUnchanged: z.boolean(),
}).passthrough();
function repairSemantics(value: z.infer<typeof repairReceipt>, context: z.RefinementCtx): void {
  const issue = (message: string, path: Array<string | number> = []) => context.addIssue({ code: z.ZodIssueCode.custom, message, path });
  if ((value.outcome === "prepared" || value.outcome === "blocked") && value.executed) issue("Prepared or blocked repair receipts cannot claim execution", ["executed"]);
  if (value.outcome !== "verified") return;
  if (!value.executed) issue("Verified repair requires executed regression checks", ["executed"]);
  if (value.reasons.length) issue("Verified repair cannot contain unresolved rejection reasons", ["reasons"]);
  for (const key of ["original", "candidate"] as const) {
    const proof = value.executionSources?.[key], run = value[key];
    const before = proof?.before, after = proof?.after;
    const fields = ["commit", "indexHash", "trackedStatusHash", "sourceHash", "trackedFilesHash"] as const;
    if (!proof || proof.status !== "unchanged" || proof.runId !== run.runId || !before || !after || !before.trackedFilesHash || !after.trackedFilesHash || before.commit !== run.commit || after.commit !== run.commit || fields.some(field => before[field] !== after[field])) issue(`Verified repair requires matching ${key} execution source observations`, ["executionSources", key]);
  }
  const before = value.beforeRegression;
  if (!before) { issue("Verified repair requires before-regression execution evidence", ["beforeRegression"]); return; }
  if (before.sourceUnchanged !== true) issue("Verified repair requires unchanged execution source", ["beforeRegression", "sourceUnchanged"]);
  if (before.commit !== value.original.commit) issue("Regression execution must use the original commit", ["beforeRegression", "commit"]);
  if (before.runId === value.original.runId || before.runId === value.candidate.runId || value.original.runId === value.candidate.runId) issue("Verified repair requires distinct original, candidate and regression runs", ["beforeRegression", "runId"]);
  const execution = before.executionSource, observed = before.observedSource;
  if (!execution || !observed || !execution.trackedFilesHash || !observed.trackedFilesHash) {
    issue("Verified repair requires complete before and after source fingerprints", ["beforeRegression"]);
  } else {
    if (execution.commit !== value.original.commit || observed.commit !== value.original.commit) issue("Source fingerprints must bind the original commit", ["beforeRegression"]);
    for (const field of ["commit", "indexHash", "trackedStatusHash", "sourceHash", "trackedFilesHash"] as const) {
      if (execution[field] !== observed[field]) issue(`Source fingerprint ${field} changed during execution`, ["beforeRegression", "observedSource", field]);
    }
  }
  const paths = before.testOverlay?.map((entry) => entry.path);
  if (!paths || paths.length !== value.testFiles.length || new Set(paths).size !== paths.length || new Set(value.testFiles).size !== value.testFiles.length || !value.testFiles.every((path) => paths.includes(path))) issue("Regression overlay must identify every supplied test file exactly once", ["beforeRegression", "testOverlay"]);
  if (new Set(value.regressionChecks).size !== value.regressionChecks.length) issue("Regression check identifiers must be unique", ["regressionChecks"]);
}

function reproductionSemantics(value: z.infer<typeof reproductionReceipt>, context: z.RefinementCtx): void {
  if (value.outcome === "reproduced" && (!value.executed || !value.sourceUnchanged)) context.addIssue({ code: z.ZodIssueCode.custom, message: "Reproduced failure requires actual execution with unchanged source" });
}

export const repairVerificationSchema = repairReceipt.superRefine(repairSemantics);
export const reproductionResultSchema = reproductionReceipt.superRefine(reproductionSemantics);
// Zod 3 requires plain objects inside discriminatedUnion. Apply the same semantic
// checks at the union boundary so callers cannot bypass the standalone schemas.
export const verificationReceiptSchema = z.discriminatedUnion("kind", [repairReceipt, changeVerificationSchema, reproductionReceipt]).superRefine((value, context) => {
  if (value.kind === "canary.repair-verification") repairSemantics(value, context);
  else if (value.kind === "canary.reproduction-result") reproductionSemantics(value, context);
});
export type VerificationReceipt = z.infer<typeof verificationReceiptSchema>;
