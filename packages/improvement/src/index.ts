import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AssertionSpec, CoverageGateResult, CoverageSummary, EvalResult, TestCase } from "@canary/core";
import { snapshotSourceCase } from "@canary/core";
import { attributeFailure, decideAdmission, type AdmissionDecision, type ComparisonVerdict, type FailureAttribution, type FailureKind, type SuggestionCategory } from "@canary/evaluators";

export type { FailureAttribution, FailureKind, SuggestionCategory, AdmissionDecision, ComparisonVerdict };

export interface ImprovementEvidence { type: "trace" | "assertion" | "coverage" | "state"; ref: string }
export interface ImprovementSuggestion {
  id: string;
  runId: string;
  caseId: string;
  kind: FailureKind;
  category: SuggestionCategory;
  rationale: string;
  evidence: ImprovementEvidence[];
  proposedCase?: Partial<TestCase>;
  generation?: { status: "ok" | "unavailable"; reason?: string };
  status: "proposed" | "accepted" | "rejected" | "verified";
  confidence: number;
}

export interface ComparableRun {
  runId: string;
  results: EvalResult[];
  coverage?: CoverageSummary;
  status?: string;
  gate?: CoverageGateResult;
}

export interface ComparisonCompleteness {
  passed: boolean;
  missingBaselinePassing: string[];
  missingCandidate: string[];
  duplicateIds: string[];
  cancelledOrError: string[];
  datasetMismatch: boolean;
  reasons: string[];
}

export interface RunComparison {
  v: 1;
  baselineRunId: string;
  candidateRunId: string;
  verdict: ComparisonVerdict;
  comparable: boolean;
  completeness: ComparisonCompleteness;
  regressions: string[];
  improvements: string[];
  coverageDelta: {
    lines?: number;
    branches?: number;
    functions?: number;
    comparable: boolean;
    reason?: string;
  };
  admission: AdmissionDecision;
}

export function trialKey(result: Pick<EvalResult, "caseId" | "repetition">): string {
  return result.repetition !== undefined ? `${result.caseId}#${result.repetition}` : result.caseId;
}

export function isHoldoutCase(result: EvalResult): boolean {
  const tags = result.sourceCase?.tags ?? [];
  const split = result.sourceCase?.dataset?.split;
  return tags.includes("holdout") || split === "holdout";
}

export function proposeCoverageGap(featureId: string): ImprovementSuggestion {
  return { id: `suggestion_${featureId}`, runId: "", caseId: "", kind: "coverage_gap", category: "test_gap", rationale: `Add a deterministic test for feature ${featureId}.`, evidence: [], status: "proposed", confidence: 0.4, generation: { status: "unavailable", reason: "coverage gap suggestions are not auto-generated cases" } };
}

export { attributeFailure };
export { assessSoftTrial, softTrialDatasetIdentity, type SoftTrialAuthorization, type SoftTrialRecord, type SoftTrialStatus, type SoftTrialValidation } from "./soft-trial.js";
export { compareProjectRuns, type ProjectComparisonInput } from "./project-comparison.js";

function isPlainJson(value: unknown): boolean {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isPlainJson);
  if (value && typeof value === "object") {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
    return Object.values(value as Record<string, unknown>).every(isPlainJson);
  }
  return false;
}

export function serializeAssertion(assertion: AssertionSpec): { ok: true; value: AssertionSpec } | { ok: false; reason: string } {
  if (assertion.type === "output.predicate") return { ok: false, reason: "output.predicate is not serializable" };
  if (assertion.type === "output.schema") return { ok: false, reason: "output.schema cannot be reconstructed from a live schema object" };
  try {
    const json = JSON.parse(JSON.stringify(assertion)) as AssertionSpec;
    if (!json || json.type !== assertion.type) return { ok: false, reason: "assertion lost type during serialize" };
    if (!isPlainJson(json)) return { ok: false, reason: "assertion contains non-JSON values" };
    return { ok: true, value: json };
  } catch {
    return { ok: false, reason: "assertion contains non-JSON values" };
  }
}

export { snapshotSourceCase };

function indexTrials(results: EvalResult[]): { byKey: Map<string, EvalResult>; duplicates: string[] } {
  const byKey = new Map<string, EvalResult>();
  const seen = new Map<string, number>();
  const duplicates: string[] = [];
  for (const result of results) {
    const key = trialKey(result);
    seen.set(key, (seen.get(key) ?? 0) + 1);
    byKey.set(key, result);
  }
  for (const [key, count] of seen) {
    if (count > 1) duplicates.push(key);
  }
  return { byKey, duplicates };
}

function trialStatus(result: EvalResult): "cancelled" | "timeout" | "error" | "completed" {
  if (result.failureCategory === "cancelled" || result.trajectory?.termination === "cancelled") return "cancelled";
  if (result.failureCategory === "timeout" || result.trajectory?.termination === "timeout") return "timeout";
  if (result.failureCategory === "runtime_error" || result.trajectory?.termination === "error") return "error";
  return "completed";
}

export function holdoutCaseIds(results: EvalResult[]): string[] {
  return [...new Set(results.filter(isHoldoutCase).map((result) => trialKey(result)))];
}

function datasetFingerprint(results: EvalResult[]): string | undefined {
  const hashes = [...new Set(results.map((result) => result.sourceCase?.dataset?.contentHash).filter((value): value is string => Boolean(value)))];
  if (!hashes.length) return undefined;
  return hashes.length === 1 ? hashes[0] : "mixed";
}

export function compareRuns(baseline: ComparableRun, candidate: ComparableRun, holdoutIds: string[] = holdoutCaseIds([...baseline.results, ...candidate.results])): RunComparison {
  const baseIndex = indexTrials(baseline.results);
  const candIndex = indexTrials(candidate.results);
  const ids = [...new Set([...baseIndex.byKey.keys(), ...candIndex.byKey.keys()])];
  const regressions: string[] = [];
  const improvements: string[] = [];
  const missingBaselinePassing: string[] = [];
  const missingCandidate: string[] = [];
  const cancelledOrError: string[] = [];
  const reasons: string[] = [];

  for (const id of ids) {
    const before = baseIndex.byKey.get(id);
    const after = candIndex.byKey.get(id);
    if (before?.passed && !after) missingBaselinePassing.push(id);
    if (before && !after) missingCandidate.push(id);
    if (after && (trialStatus(after) === "cancelled" || trialStatus(after) === "timeout" || trialStatus(after) === "error")) cancelledOrError.push(id);
    if (before?.passed && after && !after.passed) regressions.push(id);
    if (before && !before.passed && after?.passed) improvements.push(id);
  }

  const holdoutFailed = holdoutIds.filter((id) => {
    const after = candIndex.byKey.get(id) ?? [...candIndex.byKey.values()].find((result) => result.caseId === id);
    return after && !after.passed;
  });
  for (const id of holdoutFailed) {
    const label = id.startsWith("holdout:") ? id : `holdout:${id}`;
    if (!regressions.includes(label)) regressions.push(label);
  }

  const baseHash = datasetFingerprint(baseline.results);
  const candHash = datasetFingerprint(candidate.results);
  const datasetMismatch = Boolean(baseHash && candHash && baseHash !== candHash);

  if (baseIndex.duplicates.length) reasons.push(`duplicate baseline trial ids: ${baseIndex.duplicates.join(", ")}`);
  if (candIndex.duplicates.length) reasons.push(`duplicate candidate trial ids: ${candIndex.duplicates.join(", ")}`);
  if (missingBaselinePassing.length) reasons.push(`missing baseline passing trials: ${missingBaselinePassing.join(", ")}`);
  if (cancelledOrError.length) reasons.push(`candidate trials cancelled/timed out/errored: ${cancelledOrError.join(", ")}`);
  if (datasetMismatch) reasons.push("baseline and candidate dataset content hashes differ");
  if (candidate.status === "cancelled") reasons.push("candidate run cancelled");

  const completeness: ComparisonCompleteness = {
    passed: reasons.length === 0,
    missingBaselinePassing,
    missingCandidate,
    duplicateIds: [...baseIndex.duplicates, ...candIndex.duplicates],
    cancelledOrError,
    datasetMismatch,
    reasons,
  };

  const coverageMetrics = ["lines", "branches", "functions"] as const;
  const coverageDelta: RunComparison["coverageDelta"] = { comparable: true };
  const baseFinal = baseline.coverage?.status === "final";
  const candFinal = candidate.coverage?.status === "final";
  if (!baseFinal || !candFinal || !baseline.coverage || !candidate.coverage) {
    coverageDelta.comparable = false;
    coverageDelta.reason = "coverage is unavailable or not final; delta is not treated as 0";
  } else {
    for (const key of coverageMetrics) {
      if (baseline.coverage[key].total !== candidate.coverage[key].total) {
        coverageDelta.comparable = false;
        coverageDelta.reason = "coverage denominators differ; collectors are not ranked";
        break;
      }
      coverageDelta[key] = candidate.coverage[key].pct - baseline.coverage[key].pct;
    }
  }

  let verdict: ComparisonVerdict;
  if (!completeness.passed) verdict = "incomparable";
  else if (regressions.length) verdict = "reject";
  else if (improvements.length) verdict = "improve";
  else verdict = "keep";

  const expectedPolicyCases = [...baseline.results, ...candidate.results].filter((result) =>
    result.assertions.some((item) => item.id.startsWith("trajectory.required_event") && String((item.details as { event?: string } | undefined)?.event ?? "") === "policy.violation"),
  ).length;

  const admission = decideAdmission({
    completenessPassed: completeness.passed,
    completenessReasons: completeness.reasons,
    verdict,
    regressions,
    candidateStatus: candidate.status,
    candidateGate: candidate.gate,
    baselineCoverage: baseline.coverage,
    candidateCoverage: candidate.coverage,
    trialCount: Math.max(baseline.results.length, candidate.results.length),
    expectedPolicyCases,
  });

  return {
    v: 1,
    baselineRunId: baseline.runId,
    candidateRunId: candidate.runId,
    verdict,
    comparable: completeness.passed,
    completeness,
    regressions,
    improvements,
    coverageDelta,
    admission,
  };
}

export function exitCodeForComparison(comparison: RunComparison, candidateExitCode = 0): number {
  if (candidateExitCode !== 0) return 1;
  if (comparison.verdict === "reject" || comparison.verdict === "incomparable") return 1;
  if (comparison.admission.verdict === "reject" || comparison.admission.verdict === "incomparable") return 1;
  return 0;
}

export function proposeFromResults(runId: string, results: EvalResult[]): ImprovementSuggestion[] {
  return results.filter((result) => !result.passed).map((result, index) => {
    const attribution = attributeFailure(result);
    const generated = buildProposedCase(result);
    return {
      id: `suggestion_${runId}_${result.caseId}_${index + 1}`,
      runId,
      caseId: result.caseId,
      kind: attribution.kind,
      category: attribution.category,
      rationale: generated.reason ? `${attribution.rationale} (${generated.reason})` : attribution.rationale,
      evidence: attribution.evidence,
      proposedCase: generated.proposedCase,
      generation: generated.generation,
      status: "proposed" as const,
      confidence: attribution.confidence,
    };
  });
}

function buildProposedCase(result: EvalResult): { proposedCase?: Partial<TestCase>; generation: ImprovementSuggestion["generation"]; reason?: string } {
  const source = result.sourceCase;
  if (!source || source.input === undefined) {
    return { generation: { status: "unavailable", reason: "original case input is missing; refusing to forge a TestCase from output" }, reason: "cannot generate draft" };
  }
  const assertions: AssertionSpec[] = [];
  for (const assertion of source.assertions ?? []) {
    const serialized = serializeAssertion(assertion);
    if (!serialized.ok) {
      return { generation: { status: "unavailable", reason: serialized.reason }, reason: serialized.reason };
    }
    assertions.push(serialized.value);
  }
  return {
    generation: { status: "ok" },
    proposedCase: {
      id: `${source.id}.regression`,
      input: source.input,
      tags: [...new Set([...(source.tags ?? []), "regression"])],
      expectedFeatures: source.expectedFeatures,
      assertions,
      environment: source.environment,
      dataset: source.dataset ? { ...source.dataset, split: "regression" } : { split: "regression" },
    },
  };
}

export function decideSuggestion(suggestion: ImprovementSuggestion, status: ImprovementSuggestion["status"]): ImprovementSuggestion {
  if (suggestion.status === "verified" && status !== "verified") throw new Error("Verified suggestions are immutable");
  if (status === "verified" && suggestion.status !== "accepted") throw new Error("Only accepted suggestions can be verified");
  if (status === "accepted" && suggestion.status === "rejected") throw new Error("Reopen a rejected suggestion before accepting");
  return { ...suggestion, status };
}

export function applySuggestionDecision(suggestions: ImprovementSuggestion[], suggestionId: string, status: ImprovementSuggestion["status"]): ImprovementSuggestion[] {
  const index = suggestions.findIndex((item) => item.id === suggestionId);
  if (index < 0) throw new Error(`Suggestion not found: ${suggestionId}`);
  const next = [...suggestions];
  next[index] = decideSuggestion(next[index]!, status);
  return next;
}

function safeFileStem(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^\.+/, "") || "regression";
}

/** Serializes a proposed regression TestCase. Never writes Agent source. Never forges missing operands. */
export function renderRegressionDraft(suggestion: ImprovementSuggestion): string | undefined {
  if (suggestion.generation?.status === "unavailable" || !suggestion.proposedCase || suggestion.proposedCase.input === undefined) return undefined;
  const testCase = suggestion.proposedCase;
  const gate = suggestion.status === "verified" ? "verified — draft only, not independent execution evidence" : `${suggestion.status} — not an accepted Agent patch`;
  return `/** Regression draft from canary improve (${suggestion.id}). Status: ${gate}. accepted/verified is not a substitute for a passing run. */\nexport default ${JSON.stringify({
    id: testCase.id ?? `${suggestion.caseId}.regression`,
    tags: testCase.tags ?? ["regression"],
    input: testCase.input,
    assertions: testCase.assertions ?? [],
    expectedFeatures: testCase.expectedFeatures,
    environment: testCase.environment,
    dataset: testCase.dataset,
  }, null, 2)};\n`;
}

export function writeRegressionDrafts(suggestions: ImprovementSuggestion[], outDir: string): string[] {
  mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  for (const suggestion of suggestions) {
    const body = renderRegressionDraft(suggestion);
    if (!body) continue;
    const file = resolve(outDir, `${safeFileStem(suggestion.proposedCase?.id ?? `${suggestion.caseId}.regression`)}.ts`);
    writeFileSync(file, body, "utf8");
    written.push(file);
  }
  return written;
}

export function verifiedRegressionDrafts(suggestions: ImprovementSuggestion[], outDir: string): string[] {
  return writeRegressionDrafts(suggestions.filter((item) => item.status === "verified"), outDir);
}
