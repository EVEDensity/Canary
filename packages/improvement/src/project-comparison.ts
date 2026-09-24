import { createHash } from "node:crypto";
import type { ProjectCheckResult, ProjectChecksConfig, RunSnapshot } from "@canary/core";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}
function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
function counts(checks: ProjectCheckResult[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const check of checks.filter((item) => item.status !== "passed")) result[check.category] = (result[check.category] ?? 0) + 1;
  return result;
}
function rate(checks: ProjectCheckResult[]): number | null {
  return checks.length ? checks.filter((item) => item.status === "passed").length / checks.length : null;
}
function duration(checks: ProjectCheckResult[]): number {
  return checks.reduce((total, item) => total + item.durationMs, 0);
}

export interface ProjectComparisonInput {
  baseline: RunSnapshot;
  candidate: RunSnapshot;
  baselinePlan: ProjectChecksConfig;
  candidatePlan: ProjectChecksConfig;
  baselineManifestHash: string;
  candidateManifestHash: string;
  regressionCheckIds: string[];
  holdoutCheckIds: string[];
}

/** Offline assessment of sealed project-check results. It never runs commands or approves an experience. */
export function compareProjectRuns(input: ProjectComparisonInput) {
  const baseline = input.baseline, candidate = input.candidate;
  const regression = [...new Set(input.regressionCheckIds)].sort();
  const holdout = [...new Set(input.holdoutCheckIds)].sort();
  const baselinePlanHash = digest(input.baselinePlan);
  const candidatePlanHash = digest(input.candidatePlan);
  const before = new Map((baseline.checks ?? []).map((item) => [item.id, item]));
  const after = new Map((candidate.checks ?? []).map((item) => [item.id, item]));
  const planIds = input.baselinePlan.checks.map((item) => item.id);
  const reasons: string[] = [];
  if (!/^[a-f0-9]{64}$/.test(input.baselineManifestHash) || !/^[a-f0-9]{64}$/.test(input.candidateManifestHash)) reasons.push("verified_manifest_required");
  if (baselinePlanHash !== candidatePlanHash) reasons.push("check_plan_changed");
  if (!regression.length) reasons.push("regression_set_empty");
  if (!holdout.length) reasons.push("holdout_set_empty");
  if (regression.some((id) => holdout.includes(id))) reasons.push("regression_holdout_overlap");
  if ([...regression, ...holdout].some((id) => !planIds.includes(id))) reasons.push("selected_check_missing_from_plan");
  if (new Set(before.keys()).size !== (baseline.checks ?? []).length || new Set(after.keys()).size !== (candidate.checks ?? []).length) reasons.push("duplicate_check_result");
  if (planIds.some((id) => !before.has(id) || !after.has(id)) || [...before.keys(), ...after.keys()].some((id) => !planIds.includes(id))) reasons.push("check_result_incomplete");
  if (baseline.status !== "completed" && baseline.status !== "failed") reasons.push("baseline_incomplete");
  if (candidate.status !== "completed") reasons.push("candidate_incomplete");
  if (candidate.gate?.hardGate?.passed === false || candidate.gate?.reason === "hard_gate_failed") reasons.push("hard_gate_failed");
  if (candidate.gate?.passed === false) reasons.push("candidate_gate_failed");
  if (input.candidatePlan.checks.some((check) => check.required && after.get(check.id)?.status !== "passed")) reasons.push("candidate_required_check_failed");
  if (holdout.some((id) => before.get(id)?.status !== "passed")) reasons.push("baseline_holdout_not_passing");
  const improvements = regression.filter((id) => before.get(id)?.status !== "passed" && after.get(id)?.status === "passed");
  const regressions = planIds.filter((id) => before.get(id)?.status === "passed" && after.get(id)?.status !== "passed");
  if (holdout.some((id) => after.get(id)?.status !== "passed")) reasons.push("holdout_failed");
  if (regressions.length) reasons.push("passing_check_regressed");
  if (!improvements.length) reasons.push("no_regression_improved");
  const baseChecks = baseline.checks ?? [], candChecks = candidate.checks ?? [];
  const beforeCoverage = baseline.coverage, afterCoverage = candidate.coverage;
  const coverageComparable = Boolean(beforeCoverage?.status === "final" && afterCoverage?.status === "final" && beforeCoverage.sourceHash === afterCoverage.sourceHash && beforeCoverage.lines.total === afterCoverage.lines.total);
  const coverage = coverageComparable && beforeCoverage && afterCoverage
    ? { status: "comparable" as const, beforePct: beforeCoverage.lines.pct, afterPct: afterCoverage.lines.pct, deltaPct: afterCoverage.lines.pct - beforeCoverage.lines.pct }
    : { status: "unavailable" as const, reason: "final matching source and denominator required" };
  const comparable = !reasons.some((reason) => ["verified_manifest_required", "check_plan_changed", "regression_set_empty", "holdout_set_empty", "regression_holdout_overlap", "selected_check_missing_from_plan", "duplicate_check_result", "check_result_incomplete", "baseline_incomplete"].includes(reason));
  const verdict = !comparable ? "incomparable" : reasons.length ? "reject" : "improve";
  const body = {
    v: 1 as const,
    kind: "canary.project-experience-comparison" as const,
    verdict,
    observedImprovement: verdict === "improve",
    admissible: false as const,
    attribution: { status: "unverified" as const, reason: "project run snapshots do not prove an experience was loaded; use an isolated soft-trial for causal evidence" },
    reasons,
    evidence: {
      baseline: { runId: baseline.runId, manifestHash: input.baselineManifestHash, planHash: baselinePlanHash },
      candidate: { runId: candidate.runId, manifestHash: input.candidateManifestHash, planHash: candidatePlanHash },
      datasetIdentity: digest({ planHash: baselinePlanHash, regression, holdout }),
    },
    selection: { regression, holdout },
    improvements,
    regressions,
    checks: planIds.map((id) => ({ id, before: before.get(id)?.status ?? "missing", after: after.get(id)?.status ?? "missing", beforeCategory: before.get(id)?.category ?? "missing", afterCategory: after.get(id)?.category ?? "missing" })),
    metrics: {
      passRate: { before: rate(baseChecks), after: rate(candChecks) },
      durationMs: { before: duration(baseChecks), after: duration(candChecks) },
      errorCategories: { before: counts(baseChecks), after: counts(candChecks) },
      coverage,
      retries: { status: "unavailable" as const, reason: "two snapshots do not establish a complete retry history" },
      tokens: { status: "unavailable" as const, reason: "project check results do not record model token usage" },
    },
  };
  return { ...body, reportHash: digest(body) };
}
