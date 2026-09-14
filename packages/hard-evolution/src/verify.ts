import type { EvalResult } from "@canary/core";
import { decideAdmission } from "@canary/evaluators";
import { compareRuns, type ComparableRun } from "@canary/improvement";
import { PolicyDenied } from "@canary/policy";
import { CandidateWorkspace, rejectForgedReport, type CandidateManifest, type CandidateVerification } from "./workspace.js";

export interface IndependentRun {
  runId: string;
  results: EvalResult[];
  status?: string;
}

export function verifyCandidate(input: {
  workspace: CandidateWorkspace;
  candidateId: string;
  baseline: IndependentRun;
  candidate: IndependentRun;
  forgedReport?: Record<string, unknown>;
}): CandidateManifest {
  const manifest = input.workspace.read(input.candidateId);
  if (input.forgedReport) {
    try { rejectForgedReport(input.forgedReport); }
    catch (error) {
      manifest.status = "rejected";
      manifest.verification = {
        valid: false,
        comparable: false,
        reasons: [error instanceof Error ? error.message : String(error)],
        independent: true,
        candidateReportIgnored: true,
      };
      return input.workspace.save(manifest);
    }
  }

  const baseline: ComparableRun = { runId: input.baseline.runId, results: input.baseline.results, status: input.baseline.status };
  const candidate: ComparableRun = { runId: input.candidate.runId, results: input.candidate.results, status: input.candidate.status };
  const comparison = compareRuns(baseline, candidate);
  const admission = comparison.admission ?? decideAdmission({
    completenessPassed: comparison.completeness.passed,
    completenessReasons: comparison.completeness.reasons,
    verdict: comparison.verdict,
    regressions: comparison.regressions,
    candidateStatus: candidate.status,
    trialCount: candidate.results.length,
  });

  const reasons = [...comparison.completeness.reasons, ...admission.reasons];
  const valid = comparison.comparable && comparison.completeness.passed && comparison.verdict === "improve" && comparison.regressions.length === 0 && admission.verdict !== "reject" && admission.verdict !== "incomparable";
  const verification: CandidateVerification = {
    valid,
    comparable: comparison.comparable,
    verdict: comparison.verdict,
    admission: admission.verdict,
    reasons,
    independent: true,
    candidateReportIgnored: true,
  };
  if (!valid || comparison.verdict === "incomparable" || admission.verdict === "incomparable") {
    manifest.status = "rejected";
    manifest.verification = verification;
    manifest.queueError = "failed or uncertain candidates do not enter the apply queue";
    return input.workspace.save(manifest);
  }
  if (admission.verdict === "reject") {
    manifest.status = "rejected";
    manifest.verification = verification;
    return input.workspace.save(manifest);
  }
  manifest.status = "verified";
  manifest.verification = verification;
  return input.workspace.save(manifest);
}

export function enqueueIfVerified(workspace: CandidateWorkspace, candidateId: string): CandidateManifest {
  const manifest = workspace.read(candidateId);
  if (manifest.status !== "verified" || !manifest.verification?.valid) {
    throw new PolicyDenied("POL-06", manifest.queueError ?? "unverified candidates cannot enter the apply queue");
  }
  manifest.status = "queued";
  return workspace.save(manifest);
}
