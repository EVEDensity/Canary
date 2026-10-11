import { describe, expect, it } from "vitest";
import { repairVerificationSchema, reproductionResultSchema, verificationReceiptSchema } from "../src/verification.js";

const digest = "a".repeat(64), originalCommit = "b".repeat(40), candidateCommit = "c".repeat(40);
function verifiedRepair() {
  const source = { commit: originalCommit, indexHash: digest, trackedStatusHash: digest, sourceHash: digest, trackedFilesHash: digest };
  return {
    v: 1, kind: "canary.repair-verification", outcome: "verified",
    original: { runId: "run_original", commit: originalCommit, manifestHash: digest },
    candidate: { runId: "run_candidate", commit: candidateCommit, manifestHash: digest },
    executionSources: {
      original: { v: 1, kind: "canary.execution-source", runId: "run_original", status: "unchanged", before: { ...source }, after: { ...source } },
      candidate: { v: 1, kind: "canary.execution-source", runId: "run_candidate", status: "unchanged", before: { ...source, commit: candidateCommit }, after: { ...source, commit: candidateCommit } },
    },
    regressionChecks: ["regression"], testFiles: ["regression.test.mjs"], executed: true, reasons: [] as string[], reviewRequired: true,
    beforeRegression: {
      runId: "run_regression", commit: originalCommit, manifestHash: digest, sourceUnchanged: true,
      executionSource: { ...source }, observedSource: { ...source },
      testOverlay: [{ path: "regression.test.mjs", hash: digest }],
      sourceBasis: "baseline production source with candidate regression files",
    },
  };
}
function reproduced() {
  return { v: 1, kind: "canary.reproduction-result", sourceRunId: "run_original", sourceManifestHash: digest, runId: "run_reproduced", outcome: "reproduced", executed: true, sourceUnchanged: true };
}
function rejectedRepair(value: unknown) {
  expect(repairVerificationSchema.safeParse(value).success).toBe(false);
  expect(verificationReceiptSchema.safeParse(value).success).toBe(false);
}

describe("verification receipt semantics", () => {
  it("accepts the current repair proof and retains advisory review requirements", () => {
    const receipt = verifiedRepair();
    expect(repairVerificationSchema.parse(receipt)).toEqual(receipt);
    expect(verificationReceiptSchema.parse(receipt)).toMatchObject({ outcome: "verified", reviewRequired: true });
  });

  it.each(["executed", "sourceUnchanged", "regressionCommit", "executionCommit", "observedCommit", "reasons", "sameRun"])("rejects contradictory verified repair evidence: %s", (change) => {
    const receipt = verifiedRepair();
    if (change === "executed") receipt.executed = false;
    if (change === "sourceUnchanged") receipt.beforeRegression.sourceUnchanged = false;
    if (change === "regressionCommit") receipt.beforeRegression.commit = candidateCommit;
    if (change === "executionCommit") receipt.beforeRegression.executionSource.commit = candidateCommit;
    if (change === "observedCommit") receipt.beforeRegression.observedSource.commit = candidateCommit;
    if (change === "reasons") receipt.reasons = ["Source not established"];
    if (change === "sameRun") receipt.beforeRegression.runId = receipt.original.runId;
    rejectedRepair(receipt);
  });

  it.each(["indexHash", "trackedStatusHash", "sourceHash", "trackedFilesHash"] as const)("rejects changed %s even when sourceUnchanged is true", (field) => {
    const receipt = verifiedRepair();
    receipt.beforeRegression.observedSource[field] = "d".repeat(64);
    rejectedRepair(receipt);
  });

  it.each(["beforeRegression", "executionSource", "observedSource", "trackedFilesHash", "testOverlay"])("does not upgrade legacy selection or incomplete proof: %s", (missing) => {
    const receipt = verifiedRepair() as Record<string, any>;
    if (missing === "beforeRegression") delete receipt.beforeRegression;
    else if (missing === "trackedFilesHash") {
      delete receipt.beforeRegression.executionSource.trackedFilesHash;
      delete receipt.beforeRegression.observedSource.trackedFilesHash;
    } else delete receipt.beforeRegression[missing];
    receipt.selection = { caseIds: ["regression"] };
    rejectedRepair(receipt);
  });

  it("requires exactly the same test overlay and rejects duplicate check identities", () => {
    const receipt = verifiedRepair();
    receipt.beforeRegression.testOverlay[0]!.path = "another.test.mjs";
    rejectedRepair(receipt);
    const duplicated = verifiedRepair();
    duplicated.regressionChecks.push("regression");
    rejectedRepair(duplicated);
    const repeatedTest = verifiedRepair();
    repeatedTest.testFiles.push("regression.test.mjs");
    repeatedTest.beforeRegression.testOverlay.push({ ...repeatedTest.beforeRegression.testOverlay[0]! });
    rejectedRepair(repeatedTest);
  });

  it.each(["missing", "status", "runId", "commit", "hash"])("requires candidate execution observations: %s", change => {
    const receipt = verifiedRepair() as Record<string, any>;
    if (change === "missing") delete receipt.executionSources;
    else if (change === "status") receipt.executionSources.candidate.status = "changed";
    else if (change === "runId") receipt.executionSources.candidate.runId = "run_other";
    else if (change === "commit") receipt.executionSources.candidate.after.commit = originalCommit;
    else receipt.executionSources.candidate.after.trackedFilesHash = "d".repeat(64);
    rejectedRepair(receipt);
  });

  it("keeps unsuccessful historical receipts readable without claiming verification", () => {
    const receipt = { ...verifiedRepair(), outcome: "evidence-insufficient", executed: false } as Record<string, any>;
    delete receipt.beforeRegression;
    expect(verificationReceiptSchema.safeParse(receipt).success).toBe(true);
    expect(verificationReceiptSchema.safeParse({ ...receipt, outcome: "prepared" }).success).toBe(true);
    rejectedRepair({ ...receipt, outcome: "prepared", executed: true });
    rejectedRepair({ ...receipt, outcome: "blocked", executed: true });
  });

  it.each([[false, true], [true, false], [false, false]])("rejects reproduced with executed=%s and sourceUnchanged=%s", (executed, sourceUnchanged) => {
    const receipt = { ...reproduced(), executed, sourceUnchanged };
    expect(reproductionResultSchema.safeParse(receipt).success).toBe(false);
    expect(verificationReceiptSchema.safeParse(receipt).success).toBe(false);
  });

  it("accepts an actual reproduced result and honest blocked evidence", () => {
    expect(reproductionResultSchema.safeParse(reproduced()).success).toBe(true);
    expect(verificationReceiptSchema.safeParse(reproduced()).success).toBe(true);
    expect(verificationReceiptSchema.safeParse({ ...reproduced(), outcome: "blocked", executed: false, sourceUnchanged: false }).success).toBe(true);
  });

  it.each([verifiedRepair(), reproduced(), { v: 1, kind: "canary.change-verification", runId: "run_candidate", baseline: originalCommit, commit: candidateCommit, manifestHash: digest, files: [], contracts: [] }])("rejects unknown receipt versions and kinds", (receipt) => {
    expect(verificationReceiptSchema.safeParse({ ...receipt, v: 2 }).success).toBe(false);
    expect(verificationReceiptSchema.safeParse({ ...receipt, kind: "canary.future-verification" }).success).toBe(false);
  });

  it("rejects malformed commit and manifest identities", () => {
    const receipt = verifiedRepair();
    rejectedRepair({ ...receipt, original: { ...receipt.original, commit: "HEAD" } });
    rejectedRepair({ ...receipt, candidate: { ...receipt.candidate, manifestHash: "unsealed" } });
    rejectedRepair({ ...receipt, beforeRegression: { ...receipt.beforeRegression, executionSource: { ...receipt.beforeRegression.executionSource, indexHash: "claimed" } } });
  });
});
