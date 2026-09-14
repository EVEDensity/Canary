import type { RunSnapshot } from "@canary/core";
import { compareRuns, isHoldoutCase } from "@canary/improvement";
import { hash } from "./storage.js";

export interface Quality {
  passRate: number | null;
  judgeScore: number | null;
  judgeIdentity: string | null;
  hardGate: "passed" | "failed" | "unavailable";
}
export interface Anchor {
  id: string;
  runId: string;
  fingerprint: string;
  threshold: number;
  createdAt: string;
}
export interface HoldoutEpoch {
  id: string;
  runId: string;
  datasetHash: string;
  caseHashes: string[];
  inputHashes: string[];
  createdAt: string;
  retiredAt?: string;
}
export interface Exposure {
  epochId: string;
  channel: "training" | "proposal" | "operator";
  refHash: string;
  at: string;
}
export function quality(run: RunSnapshot): Quality {
  const scores: number[] = [];
  const identities: string[] = [];
  let unknown = false;
  for (const result of run.results) {
    for (const [index, spec] of (result.sourceCase?.assertions ?? []).entries()) {
      if (spec.type !== "judge.score") continue;
      const item = result.assertions.find(
        (a) => a.id === (typeof spec.id === "string" ? spec.id : `${spec.type}#${index + 1}`),
      );
      const d = item?.details as Record<string, unknown> | undefined;
      if (
        !d ||
        d.stub === true ||
        typeof d.provider !== "string" ||
        (typeof d.confidence === "number" &&
          d.confidence < (typeof spec.minConfidence === "number" ? spec.minConfidence : 0.5)) ||
        !["pass", "fail"].includes(String(d.verdict)) ||
        typeof d.score !== "number" ||
        !Number.isFinite(d.score)
      )
        unknown = true;
      else {
        scores.push(d.score);
        identities.push(
          JSON.stringify({ caseId: result.caseId, repetition: result.repetition, spec, provider: d.provider }),
        );
      }
    }
  }
  const unique = new Set(run.results.map((r) => `${r.caseId}#${r.repetition ?? ""}`)).size === run.results.length;
  const complete =
    unique &&
    run.status === "completed" &&
    run.results.length > 0 &&
    run.completedCases === run.totalCases &&
    run.results.length === run.totalCases &&
    run.passedCases === run.results.filter((r) => r.passed).length;
  return {
    passRate: complete ? (100 * run.results.filter((r) => r.passed).length) / run.results.length : null,
    judgeScore: complete && !unknown && scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
    judgeIdentity: complete && !unknown && scores.length ? hash(identities.sort()) : null,
    hardGate: run.gate?.hardGate ? (run.gate.hardGate.passed ? "passed" : "failed") : "unavailable",
  };
}
export function observeAnchor(anchor: Anchor, runs: RunSnapshot[]) {
  const baseline = runs.find((r) => r.runId === anchor.runId);
  const intact = Boolean(baseline && hash(baseline) === anchor.fingerprint);
  const base = baseline ? quality(baseline) : undefined;
  return {
    ...anchor,
    intact,
    points: runs
      .filter((r) => r.runId !== anchor.runId && (!baseline || r.startedAt >= baseline.startedAt))
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      .map((run) => {
        const comparison = intact && baseline ? compareRuns(baseline, run) : undefined;
        const measured = quality(run);
        const comparable = Boolean(
          comparison?.comparable &&
          comparison.completeness.passed &&
          baseline &&
          datasetIdentity(baseline) !== null &&
          datasetIdentity(baseline) === datasetIdentity(run) &&
          measured.passRate !== null &&
          base?.passRate !== null,
        );
        const passDelta =
          comparable && measured.passRate !== null && base?.passRate != null ? measured.passRate - base.passRate : null;
        const judgeDelta =
          comparable &&
          measured.judgeScore !== null &&
          base?.judgeScore != null &&
          measured.judgeIdentity === base.judgeIdentity
            ? measured.judgeScore - base.judgeScore
            : null;
        return {
          runId: run.runId,
          at: run.startedAt,
          comparable,
          passDelta,
          judgeDelta,
          drift:
            passDelta === null && judgeDelta === null
              ? "unavailable"
              : (passDelta !== null && passDelta < -anchor.threshold) ||
                  (judgeDelta !== null && judgeDelta * 100 < -anchor.threshold)
                ? "detected"
                : "within_threshold",
          admission: comparison?.admission.verdict ?? "incomparable",
          reasons: !intact
            ? ["Anchor evidence missing or changed"]
            : !comparable
              ? [...(comparison?.completeness.reasons ?? []), "Incomplete run or dataset/assertion identity changed"]
              : [],
        };
      }),
  };
}
export function holdoutIdentity(run: RunSnapshot) {
  const results = run.results.filter(isHoldoutCase);
  return {
    caseHashes: [...new Set(results.map((r) => hash(r.caseId)))].sort(),
    inputHashes: [...new Set(results.map((r) => hash(r.sourceCase?.input ?? r.input)))].sort(),
    datasetHash: hash(
      results
        .map((r) => ({ id: r.caseId, dataset: r.sourceCase?.dataset, input: r.sourceCase?.input ?? r.input }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    ),
  };
}
export function leakageAudit(epoch: HoldoutEpoch, runs: RunSnapshot[], exposures: Exposure[]) {
  const source = runs.find((r) => r.runId === epoch.runId);
  const intact = Boolean(source && holdoutIdentity(source).datasetHash === epoch.datasetHash);
  const overlaps = runs.flatMap((run) =>
    run.results
      .filter(
        (r) =>
          !isHoldoutCase(r) &&
          (epoch.caseHashes.includes(hash(r.caseId)) ||
            epoch.inputHashes.includes(hash(r.sourceCase?.input ?? r.input))),
      )
      .map((r) => ({ runId: run.runId, caseHash: hash(r.caseId), kind: "non_holdout_overlap" })),
  );
  const declared = exposures.filter((e) => e.epochId === epoch.id);
  return {
    epochId: epoch.id,
    intact,
    status: !intact
      ? "unavailable"
      : overlaps.length || declared.some((e) => e.channel !== "operator")
        ? "risk_detected"
        : "no_observed_overlap",
    overlaps,
    exposures: declared,
    limitation: "Observed evidence only; unknown off-system exposure is not proven absent.",
  };
}

/** Missing source provenance is not sufficient for fixed-anchor comparison. */
export function datasetIdentity(run: RunSnapshot): string | null {
  if (run.results.some((r) => !r.sourceCase)) return null;
  return hash(
    run.results
      .map((r) => ({ caseId: r.caseId, repetition: r.repetition, source: r.sourceCase }))
      .sort((a, b) => (a.caseId + String(a.repetition)).localeCompare(b.caseId + String(b.repetition))),
  );
}
