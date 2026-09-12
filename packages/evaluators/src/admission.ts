import type { CoverageGateResult, CoverageSummary, EvalResult, MetricRecord } from "@canary/core";

export type AdmissionVerdict = "admit" | "reject" | "hold" | "incomparable";
export type ComparisonVerdict = "keep" | "improve" | "reject" | "incomparable";

export interface AdmissionInput {
  completenessPassed: boolean;
  completenessReasons: string[];
  verdict: ComparisonVerdict;
  regressions: string[];
  candidateStatus?: string;
  candidateGate?: CoverageGateResult;
  baselineCoverage?: CoverageSummary;
  candidateCoverage?: CoverageSummary;
  trialCount: number;
  expectedPolicyCases?: number;
}

export interface AdmissionDecision {
  v: 1;
  verdict: AdmissionVerdict;
  reasons: string[];
  hardGatePassed: boolean;
  completenessPassed: boolean;
  quality: {
    comparable: boolean;
    uncertain: boolean;
    metrics: MetricRecord[];
  };
}

const FINAL = "final";

export function coverageQualityMetric(name: string, baseline?: CoverageSummary, candidate?: CoverageSummary): MetricRecord {
  const key = name as "lines" | "branches" | "functions";
  const baseOk = baseline?.status === FINAL && baseline[key];
  const candOk = candidate?.status === FINAL && candidate[key];
  if (!baseOk || !candOk) {
    return { v: 1, name, status: "unavailable", precision: "unknown", provenance: "coverage-summary" };
  }
  if (baseline[key].total !== candidate[key].total) {
    return { v: 1, name, status: "unavailable", precision: "unknown", provenance: "coverage-denominator-mismatch" };
  }
  const mapping = baseline.files?.[0]?.quality?.precision ?? candidate.files?.[0]?.quality?.precision;
  if (mapping && mapping !== (candidate.files?.[0]?.quality?.precision ?? mapping)) {
    return { v: 1, name, status: "unavailable", precision: "unknown", provenance: "coverage-precision-mismatch" };
  }
  return {
    v: 1,
    name,
    value: candidate[key].pct - baseline[key].pct,
    status: "available",
    precision: mapping === "exact" ? "exact" : mapping === "approximate" ? "approximate" : "unknown",
    provenance: "coverage-summary",
  };
}

export function decideAdmission(input: AdmissionInput): AdmissionDecision {
  const reasons: string[] = [];
  const metrics = ["lines", "branches", "functions"].map((name) => coverageQualityMetric(name, input.baselineCoverage, input.candidateCoverage));
  const qualityComparable = metrics.every((metric) => metric.status === "available");
  const hardGatePassed = input.candidateGate?.hardGate?.passed !== false && input.candidateGate?.reason !== "hard_gate_failed";
  const cancelled = input.candidateStatus === "cancelled";

  if (!input.completenessPassed || input.verdict === "incomparable" || cancelled) {
    reasons.push(...input.completenessReasons);
    if (cancelled) reasons.push("candidate run cancelled");
    return {
      v: 1,
      verdict: "incomparable",
      reasons: reasons.length ? reasons : ["comparison is incomplete"],
      hardGatePassed,
      completenessPassed: false,
      quality: { comparable: qualityComparable, uncertain: true, metrics },
    };
  }

  if (!hardGatePassed || input.verdict === "reject" || input.regressions.length) {
    if (!hardGatePassed) reasons.push("hard gate failed; judge or coverage gains cannot offset safety/state failures");
    if (input.regressions.length) reasons.push(`regressions: ${input.regressions.join(", ")}`);
    return {
      v: 1,
      verdict: "reject",
      reasons,
      hardGatePassed,
      completenessPassed: true,
      quality: { comparable: qualityComparable, uncertain: !qualityComparable, metrics },
    };
  }

  if ((input.expectedPolicyCases ?? 0) > 0) {
    reasons.push("expected policy violations in negative tests are not a production policy exception");
  }

  const uncertain = !qualityComparable || input.trialCount < 2 || input.verdict === "improve";
  if (input.verdict === "improve" && uncertain) {
    reasons.push("quality difference is uncertain; small samples and missing metrics are not an automatic admit");
    return {
      v: 1,
      verdict: "hold",
      reasons,
      hardGatePassed,
      completenessPassed: true,
      quality: { comparable: qualityComparable, uncertain: true, metrics },
    };
  }

  if (!qualityComparable) reasons.push("coverage metrics are not comparable");
  return {
    v: 1,
    verdict: "hold",
    reasons: reasons.length ? reasons : ["admission requires an independent authorization; compare is not a release gate"],
    hardGatePassed,
    completenessPassed: true,
    quality: { comparable: qualityComparable, uncertain: true, metrics },
  };
}
