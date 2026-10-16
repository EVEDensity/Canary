import { z } from "zod";
import type { RunSnapshot } from "./types.js";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const commit = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const line = z.number().int().positive();
const projectPath = z
  .string()
  .min(1)
  .refine(
    (value) =>
      value === "." ||
      (!value.startsWith("/") &&
        !value.includes("\\") &&
        !/^[a-z]:/i.test(value) &&
        value.split("/").every((part) => part !== ".." && part !== "." && part.length > 0)),
    "Expected a project-relative path",
  );
const sourcePath = projectPath.refine((value) => value !== ".", "Expected a file path");
const metricSchema = z.object({ covered: count.nullable(), total: count.nullable() }).strict();
export const changeBehaviorContractSchema = z
  .object({
    id: z.string().min(1),
    paths: z
      .array(
        z
          .string()
          .min(1)
          .max(256)
          .refine(
            (value) =>
              !value.startsWith("/") && !value.includes("..") && !value.includes("\\") && !/^[a-z]:/i.test(value),
          ),
      )
      .min(1),
    checkId: z.string().min(1),
    assertionId: z.string().min(1),
    required: z.boolean(),
    status: z.enum(["verified", "failed", "unknown"]),
    evidence: z.string().min(1),
    checkStatus: z.string().min(1),
  })
  .strict();
export const changeFileAssessmentSchema = z
  .object({
    path: sourcePath,
    status: z.enum(["added", "modified", "deleted", "unsupported"]),
    changedLines: z.array(line).max(100_000),
    execution: z
      .object({
        status: z.enum(["measured", "unknown"]),
        lines: metricSchema,
        functions: metricSchema,
        branches: metricSchema,
        reasons: z.array(z.string().min(1)),
      })
      .strict(),
    uncovered: z
      .object({ lines: z.array(line), functions: z.array(z.string().min(1)), branches: z.array(z.string().min(1)) })
      .strict(),
    nodes: z.array(z.object({ id: z.string().min(1), kind: z.string().min(1), line: line.optional() }).strict()),
    behavior: z.enum(["declared-assertion-failed", "declared-assertions-verified", "unknown"]),
    contracts: z.array(changeBehaviorContractSchema),
    failureEvidence: z.array(z.string().min(1)),
    interpretation: z.string().min(1),
  })
  .strict();
export const changeVerificationSourceSchema = z
  .object({
    status: z.enum(["verified", "unavailable"]),
    projectPath,
    sourceHash: digest,
    configHash: digest,
    executionSourceHash: digest.optional(),
    reasons: z.array(z.string().min(1)),
  })
  .strict();
const summaryMetricSchema = z.object({ covered: count, total: count, unknownFiles: count }).strict();
export const changeGapKinds = [
  "uncovered-lines",
  "uncovered-functions",
  "uncovered-branches",
  "missing-coverage",
  "missing-behavior-contract",
  "unverified-contract",
  "failed-contract",
  "source-unavailable",
  "deleted-source",
  "unsupported-source",
  "coverage-conflict",
  "observed-failure",
] as const;
export const changeVerificationSummarySchema = z
  .object({
    files: z.object({ total: count, added: count, modified: count, deleted: count, unavailable: count }).strict(),
    execution: z
      .object({ lines: summaryMetricSchema, functions: summaryMetricSchema, branches: summaryMetricSchema })
      .strict(),
    // Behavior totals count files, independently of execution coverage denominators.
    behavior: z.object({ verified: count, failed: count, unknown: count }).strict(),
    gaps: z
      .array(z.object({ kind: z.enum(changeGapKinds), path: projectPath, reason: z.string().min(1) }).strict())
      .max(5_000),
  })
  .strict();
export const changeVerificationChecksSchema = z
  .object({
    planned: count,
    executed: count,
    passed: count,
    failed: count,
    blocked: count,
    excluded: count,
    omitted: count,
    missing: count,
  })
  .strict();

export type ChangeMetric = z.infer<typeof metricSchema>;
export type ChangeBehaviorContractAssessment = z.infer<typeof changeBehaviorContractSchema>;
export type ChangeFileAssessment = z.infer<typeof changeFileAssessmentSchema>;
export type ChangeVerificationSource = z.infer<typeof changeVerificationSourceSchema>;
export type ChangeVerificationSummary = z.infer<typeof changeVerificationSummarySchema>;
export type ChangeVerificationChecks = z.infer<typeof changeVerificationChecksSchema>;

/** Sum only known measurements. An unknown dimension contributes an unknown file,
 * never an invented zero denominator or a percentage. */
export function deriveChangeSummary(
  files: readonly ChangeFileAssessment[],
  source: ChangeVerificationSource,
): ChangeVerificationSummary {
  const result: ChangeVerificationSummary = {
    files: { total: files.length, added: 0, modified: 0, deleted: 0, unavailable: 0 },
    execution: {
      lines: { covered: 0, total: 0, unknownFiles: 0 },
      functions: { covered: 0, total: 0, unknownFiles: 0 },
      branches: { covered: 0, total: 0, unknownFiles: 0 },
    },
    behavior: { verified: 0, failed: 0, unknown: 0 },
    gaps: [],
  };
  const addGap = (kind: (typeof changeGapKinds)[number], path: string, reason: string) =>
    result.gaps.push({ kind, path, reason });
  for (const file of files) {
    result.files[file.status === "unsupported" ? "unavailable" : file.status]++;
    result.behavior[
      file.behavior === "declared-assertions-verified"
        ? "verified"
        : file.behavior === "declared-assertion-failed"
          ? "failed"
          : "unknown"
    ]++;
    const unknownMetrics: string[] = [];
    for (const dimension of ["lines", "functions", "branches"] as const) {
      const measured = file.execution[dimension],
        aggregate = result.execution[dimension];
      if (measured.covered === null || measured.total === null) {
        aggregate.unknownFiles++;
        unknownMetrics.push(dimension);
      } else {
        aggregate.covered += measured.covered;
        aggregate.total += measured.total;
      }
      if (measured.covered !== null && measured.total !== null && measured.covered < measured.total)
        addGap(
          `uncovered-${dimension}`,
          file.path,
          `${measured.total - measured.covered} of ${measured.total} changed ${dimension} were not executed`,
        );
    }
    if (file.status === "deleted")
      addGap("deleted-source", file.path, "Deleted source has no execution measurement at this revision");
    else if (file.status === "unsupported")
      addGap(
        "unsupported-source",
        file.path,
        file.execution.reasons.join("; ") || "Source cannot be analyzed reliably",
      );
    else {
      if (unknownMetrics.length)
        addGap("missing-coverage", file.path, `Execution evidence is unknown for ${unknownMetrics.join(", ")}`);
      if (!file.contracts.length)
        addGap(
          "missing-behavior-contract",
          file.path,
          "No maintainer-declared behavior assertion applies to this file",
        );
      else {
        if (file.contracts.some((contract) => contract.status === "failed"))
          addGap("failed-contract", file.path, "An applicable declared behavior assertion failed");
        if (file.contracts.some((contract) => contract.status === "unknown"))
          addGap(
            "unverified-contract",
            file.path,
            "An applicable declared behavior assertion has insufficient evidence",
          );
      }
    }
    if (file.execution.reasons.some((reason) => /conflict/i.test(reason)))
      addGap("coverage-conflict", file.path, "Conflicting coverage evidence was not combined");
    if (file.failureEvidence.length)
      addGap("observed-failure", file.path, "Recorded failure evidence refers to this file");
  }
  if (source.status === "unavailable")
    addGap(
      "source-unavailable",
      ".",
      source.reasons.join("; ") || "Execution source identity could not be established",
    );
  return result;
}

const v2Receipt = z
  .object({
    v: z.literal(2),
    kind: z.literal("canary.change-verification"),
    runId: z.string().min(1),
    baseline: commit,
    commit,
    manifestHash: digest,
    source: changeVerificationSourceSchema,
    files: z.array(changeFileAssessmentSchema).max(500),
    contracts: z.array(changeBehaviorContractSchema),
    summary: changeVerificationSummarySchema,
    assessment: z.enum(["analyzed", "evidence-insufficient"]),
    limitations: z.array(z.string().min(1)),
    checks: changeVerificationChecksSchema,
  })
  .passthrough();

function sameJson(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right))
    return left.length === right.length && left.every((item, index) => sameJson(item, right[index]));
  if (left && right && typeof left === "object" && typeof right === "object") {
    const a = left as Record<string, unknown>,
      b = right as Record<string, unknown>;
    return (
      Object.keys(a).length === Object.keys(b).length &&
      Object.keys(a).every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key]))
    );
  }
  return false;
}
/** The analyzer and receipt validator use the same project-relative glob rules. */
export function matchesBehaviorPath(path: string, pattern: string): boolean {
  let source = "";
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index]!;
    if (char === "*" && pattern[index + 1] === "*") {
      if (pattern[index + 2] === "/") {
        source += "(?:.*/)?";
        index += 2;
      } else {
        source += ".*";
        index++;
      }
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`).test(path);
}
function v2Semantics(value: z.infer<typeof v2Receipt>, context: z.RefinementCtx): void {
  const issue = (message: string, path: Array<string | number> = []) =>
    context.addIssue({ code: z.ZodIssueCode.custom, message, path });
  const unique = (values: readonly (string | number)[]) => new Set(values).size === values.length;
  if (value.source.status === "verified" && (!value.source.executionSourceHash || value.source.reasons.length))
    issue("Verified source requires execution proof and no unresolved reasons", ["source"]);
  if (value.source.status === "unavailable" && !value.source.reasons.length)
    issue("Unavailable source requires an explanation", ["source", "reasons"]);
  if (value.assessment !== (value.source.status === "verified" ? "analyzed" : "evidence-insufficient"))
    issue("Assessment must reflect source identity evidence", ["assessment"]);
  if (!unique(value.files.map((file) => file.path))) issue("Changed file paths must be unique", ["files"]);
  if (!unique(value.contracts.map((contract) => contract.id)))
    issue("Contract identifiers must be unique", ["contracts"]);
  const contractById = new Map(value.contracts.map((contract) => [contract.id, contract]));
  for (const [index, file] of value.files.entries()) {
    const base = ["files", index];
    if (
      !unique(file.changedLines) ||
      file.changedLines.some((number, i) => i > 0 && number <= file.changedLines[i - 1]!)
    )
      issue("Changed lines must be unique and ascending", [...base, "changedLines"]);
    if (!unique(file.contracts.map((contract) => contract.id)))
      issue("File contract identifiers must be unique", [...base, "contracts"]);
    for (const contract of file.contracts) {
      if (!sameJson(contractById.get(contract.id), contract))
        issue("File contract must match the recorded contract assessment", [...base, "contracts"]);
      if (!contract.paths.some((pattern) => matchesBehaviorPath(file.path, pattern)))
        issue("File contract must explicitly apply to this path", [...base, "contracts"]);
    }
    const behavior = file.contracts.some((contract) => contract.status === "failed")
      ? "declared-assertion-failed"
      : file.contracts.length && file.contracts.every((contract) => contract.status === "verified")
        ? "declared-assertions-verified"
        : "unknown";
    if (file.behavior !== behavior)
      issue("File behavior must derive from explicit contract evidence", [...base, "behavior"]);
    let known = 0;
    for (const dimension of ["lines", "functions", "branches"] as const) {
      const metric = file.execution[dimension],
        uncovered = file.uncovered[dimension];
      if ((metric.covered === null) !== (metric.total === null))
        issue("A measurement requires both numerator and denominator", [...base, "execution", dimension]);
      if (metric.covered !== null && metric.total !== null) {
        known++;
        if (metric.covered > metric.total)
          issue("Covered count cannot exceed its denominator", [...base, "execution", dimension]);
        if (uncovered.length !== metric.total - metric.covered)
          issue("Uncovered entries must match the measured deficit", [...base, "uncovered", dimension]);
      } else if (uncovered.length)
        issue("Unknown measurements cannot identify uncovered entries", [...base, "uncovered", dimension]);
      if (!unique(uncovered)) issue("Uncovered entries must be unique", [...base, "uncovered", dimension]);
    }
    if (file.uncovered.lines.some((number) => !file.changedLines.includes(number)))
      issue("Uncovered lines must lie within the changed source range", [...base, "uncovered", "lines"]);
    if (file.execution.status !== (known ? "measured" : "unknown"))
      issue("Execution status must reflect measured dimensions", [...base, "execution", "status"]);
    if (!known && !file.execution.reasons.length)
      issue("Unknown execution evidence requires an explanation", [...base, "execution", "reasons"]);
    if (
      (file.status === "deleted" || file.status === "unsupported") &&
      (known || file.behavior !== "unknown" || file.contracts.some((contract) => contract.status !== "unknown"))
    )
      issue("Deleted or unsupported source cannot claim execution or behavior verification", base);
    if (
      value.source.status === "unavailable" &&
      (known || file.behavior !== "unknown" || file.contracts.some((contract) => contract.status !== "unknown"))
    )
      issue("Unavailable source cannot claim version-bound execution or behavior verification", base);
  }
  for (const [index, contract] of value.contracts.entries()) {
    if (contract.status === "verified" && contract.checkStatus !== "passed")
      issue("Verified behavior requires a passing check", ["contracts", index]);
    if (value.source.status === "unavailable" && contract.status !== "unknown")
      issue("Unavailable source requires unknown behavior contracts", ["contracts", index, "status"]);
  }
  const checks = value.checks;
  if (
    checks.executed !== checks.passed + checks.failed + checks.blocked ||
    checks.planned !== checks.executed + checks.excluded + checks.omitted + checks.missing
  )
    issue("Check counts must preserve execution, exclusion and missing-check denominators", ["checks"]);
  if (!sameJson(value.summary, deriveChangeSummary(value.files, value.source)))
    issue("Summary must exactly derive from file and source evidence", ["summary"]);
}

export const changeVerificationV2Schema = v2Receipt.superRefine(v2Semantics);
export type ChangeVerificationV2 = z.infer<typeof changeVerificationV2Schema>;
export function isChangeVerificationV2(value: unknown): value is ChangeVerificationV2 {
  return changeVerificationV2Schema.safeParse(value).success;
}

const executionFingerprintSchema = z
  .object({
    commit,
    indexHash: digest,
    trackedStatusHash: digest,
    sourceHash: digest,
    trackedFilesHash: digest,
    commitMatches: z.boolean().optional(),
  })
  .strict();
const executionProofSchema = z
  .object({
    v: z.literal(1),
    kind: z.literal("canary.execution-source"),
    runId: z.string().min(1),
    status: z.enum(["unchanged", "changed", "unavailable"]),
    projectPath: projectPath.optional(),
    before: executionFingerprintSchema.optional(),
    after: executionFingerprintSchema.optional(),
  })
  .strict();

/** A sealed receipt can still refer to another run or obsolete source. Consumers
 * bind the document to the sealed run and the independently hashed proof before
 * projecting R26 measurements. This is source identity, not author authentication. */
export function isChangeVerificationBound(
  value: unknown,
  run: RunSnapshot,
  proof: unknown,
  proofHash?: string,
): value is ChangeVerificationV2 {
  if (!isChangeVerificationV2(value)) return false;
  const recorded = run.evidence?.reproduction;
  if (
    !recorded ||
    value.runId !== run.runId ||
    value.commit !== recorded.gitCommit ||
    value.source.sourceHash !== recorded.sourceHash ||
    value.source.configHash !== recorded.configHash ||
    value.source.projectPath !== (recorded.projectPath ?? ".")
  )
    return false;
  if (value.source.executionSourceHash !== undefined && value.source.executionSourceHash !== proofHash) return false;
  if (value.source.status === "unavailable") return true;
  if (recorded.gitDirty !== false || !proofHash) return false;
  const parsed = executionProofSchema.safeParse(proof);
  if (!parsed.success) return false;
  const observed = parsed.data,
    before = observed.before,
    after = observed.after;
  return (
    observed.runId === run.runId &&
    observed.status === "unchanged" &&
    (observed.projectPath ?? ".") === value.source.projectPath &&
    Boolean(
      before &&
      after &&
      before.commit === value.commit &&
      before.sourceHash === value.source.sourceHash &&
      before.commitMatches === true &&
      after.commitMatches === true &&
      sameJson(before, after),
    )
  );
}

// Keep this a plain ZodObject for the shared kind-discriminated receipt union.
// Version 1 is historical evidence, and is never silently upgraded to version 2.
export const changeReceipt = z
  .object({
    v: z.union([z.literal(1), z.literal(2)]),
    kind: z.literal("canary.change-verification"),
    runId: z.string().min(1),
    baseline: commit,
    commit,
    manifestHash: digest,
    files: z.array(z.object({ path: z.string(), behavior: z.string().optional() }).passthrough()),
    contracts: z.array(z.object({ id: z.string(), status: z.enum(["verified", "failed", "unknown"]) }).passthrough()),
    source: changeVerificationSourceSchema.optional(),
    summary: changeVerificationSummarySchema.optional(),
    assessment: z.enum(["analyzed", "evidence-insufficient"]).optional(),
    limitations: z.array(z.string().min(1)).optional(),
    checks: changeVerificationChecksSchema.optional(),
  })
  .passthrough();
export function changeSemantics(value: z.infer<typeof changeReceipt>, context: z.RefinementCtx): void {
  if (value.v !== 2) return;
  const parsed = changeVerificationV2Schema.safeParse(value);
  if (!parsed.success) for (const issue of parsed.error.issues) context.addIssue(issue);
}
export const changeVerificationSchema = changeReceipt.superRefine(changeSemantics);
