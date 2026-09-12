import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CoverageSummary, EvalResult, TestCase } from "@canary/core";
import { attributeFailure, type FailureAttribution, type FailureKind, type SuggestionCategory } from "@canary/evaluators";

export type { FailureAttribution, FailureKind, SuggestionCategory };

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
  status: "proposed" | "accepted" | "rejected" | "verified";
  confidence: number;
}

export interface ComparableRun {
  runId: string;
  results: EvalResult[];
  coverage?: CoverageSummary;
}

export interface RunComparison {
  baselineRunId: string;
  candidateRunId: string;
  verdict: "keep" | "improve" | "reject";
  regressions: string[];
  improvements: string[];
  coverageDelta: { lines: number; branches: number; functions: number };
}

export function proposeCoverageGap(featureId: string): ImprovementSuggestion {
  return { id: `suggestion_${featureId}`, runId: "", caseId: "", kind: "coverage_gap", category: "test_gap", rationale: `Add a deterministic test for feature ${featureId}.`, evidence: [], status: "proposed", confidence: 0.4 };
}

export { attributeFailure };

export function proposeFromResults(runId: string, results: EvalResult[]): ImprovementSuggestion[] {
  return results.filter((result) => !result.passed).map((result, index) => {
    const attribution = attributeFailure(result);
    return {
      id: `suggestion_${runId}_${result.caseId}_${index + 1}`,
      runId,
      caseId: result.caseId,
      kind: attribution.kind,
      category: attribution.category,
      rationale: attribution.rationale,
      evidence: attribution.evidence,
      proposedCase: {
        id: `${result.caseId}.regression`,
        input: result.input ?? result.output,
        tags: ["regression"],
        assertions: result.assertions.filter((item) => !item.passed && item.id !== "agent.completed").map((item) => ({ type: item.id.split("#")[0] ?? "output.exists" })),
      },
      status: "proposed" as const,
      confidence: attribution.confidence,
    };
  });
}

export function holdoutCaseIds(results: EvalResult[]): string[] {
  return [...new Set(results.filter((result) => result.caseId.startsWith("holdout") || (result as EvalResult).caseId.includes("holdout")).map((result) => result.caseId))];
}

export function compareRuns(baseline: ComparableRun, candidate: ComparableRun, holdoutIds: string[] = holdoutCaseIds([...baseline.results, ...candidate.results])): RunComparison {
  const baseById = new Map(baseline.results.map((result) => [result.caseId, result]));
  const candById = new Map(candidate.results.map((result) => [result.caseId, result]));
  const ids = [...new Set([...baseById.keys(), ...candById.keys()])];
  const regressions: string[] = [];
  const improvements: string[] = [];
  for (const id of ids) {
    const before = baseById.get(id);
    const after = candById.get(id);
    if (before?.passed && after && !after.passed) regressions.push(id);
    if (before && !before.passed && after?.passed) improvements.push(id);
  }
  const holdoutFailed = holdoutIds.filter((id) => candById.get(id) && !candById.get(id)!.passed);
  const coverageDelta = {
    lines: (candidate.coverage?.lines.pct ?? 0) - (baseline.coverage?.lines.pct ?? 0),
    branches: (candidate.coverage?.branches.pct ?? 0) - (baseline.coverage?.branches.pct ?? 0),
    functions: (candidate.coverage?.functions.pct ?? 0) - (baseline.coverage?.functions.pct ?? 0),
  };
  const verdict = regressions.length || holdoutFailed.length ? "reject" : improvements.length ? "improve" : "keep";
  return { baselineRunId: baseline.runId, candidateRunId: candidate.runId, verdict, regressions: [...regressions, ...holdoutFailed.map((id) => `holdout:${id}`)], improvements, coverageDelta };
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

/** Serializes a proposed regression TestCase. Never writes Agent source. */
export function renderRegressionDraft(suggestion: ImprovementSuggestion): string {
  const testCase = {
    id: suggestion.proposedCase?.id ?? `${suggestion.caseId}.regression`,
    tags: suggestion.proposedCase?.tags ?? ["regression"],
    input: suggestion.proposedCase?.input ?? suggestion.caseId,
    assertions: suggestion.proposedCase?.assertions?.length ? suggestion.proposedCase.assertions : [{ type: "output.exists" }],
  };
  const gate = suggestion.status === "verified" ? "verified — eligible for the default regression set" : `${suggestion.status} — not an accepted Agent patch`;
  return `/** Regression draft from canary improve (${suggestion.id}). Status: ${gate}. */\nexport default ${JSON.stringify(testCase, null, 2)};\n`;
}

export function writeRegressionDrafts(suggestions: ImprovementSuggestion[], outDir: string): string[] {
  mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  for (const suggestion of suggestions) {
    const file = resolve(outDir, `${safeFileStem(suggestion.proposedCase?.id ?? `${suggestion.caseId}.regression`)}.ts`);
    writeFileSync(file, renderRegressionDraft(suggestion), "utf8");
    written.push(file);
  }
  return written;
}

export function verifiedRegressionDrafts(suggestions: ImprovementSuggestion[], outDir: string): string[] {
  return writeRegressionDrafts(suggestions.filter((item) => item.status === "verified"), outDir);
}
