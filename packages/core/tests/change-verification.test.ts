import { describe, expect, it } from "vitest";
import {
  changeVerificationSchema,
  changeVerificationV2Schema,
  deriveChangeSummary,
  isChangeVerificationV2,
  isChangeVerificationBound,
  matchesBehaviorPath,
  type ChangeFileAssessment,
  type ChangeVerificationSource,
  type ChangeVerificationV2,
} from "../src/change-verification.js";
import { verificationReceiptSchema } from "../src/verification.js";
import type { RunSnapshot } from "../src/types.js";

const digest = "a".repeat(64);
const source: ChangeVerificationSource = {
  status: "verified",
  projectPath: ".",
  sourceHash: digest,
  configHash: "d".repeat(64),
  executionSourceHash: "b".repeat(64),
  reasons: [],
};
function measuredFile(path = "src/invoice.ts"): ChangeFileAssessment {
  return {
    path,
    status: "modified",
    changedLines: [3, 4],
    execution: {
      status: "measured",
      lines: { covered: 1, total: 2 },
      functions: { covered: 1, total: 1 },
      branches: { covered: null, total: null },
      reasons: ["Branch evidence was not collected"],
    },
    uncovered: { lines: [4], functions: [], branches: [] },
    nodes: [{ id: "file_invoice", kind: "file" }],
    behavior: "unknown",
    contracts: [],
    failureEvidence: [],
    interpretation: "Execution coverage is independent of behavior verification",
  };
}
function receipt(): ChangeVerificationV2 {
  const files = [measuredFile()];
  return {
    v: 2,
    kind: "canary.change-verification",
    runId: "run_candidate",
    baseline: "b".repeat(40),
    commit: "c".repeat(40),
    manifestHash: digest,
    source: { ...source },
    files,
    contracts: [],
    summary: deriveChangeSummary(files, source),
    assessment: "analyzed",
    limitations: ["No inferred behavior guarantees"],
    checks: { planned: 4, executed: 1, passed: 1, failed: 0, blocked: 0, excluded: 1, omitted: 1, missing: 1 },
  };
}
function reject(value: unknown) {
  expect(changeVerificationV2Schema.safeParse(value).success).toBe(false);
  expect(changeVerificationSchema.safeParse(value).success).toBe(false);
  expect(verificationReceiptSchema.safeParse(value).success).toBe(false);
  expect(isChangeVerificationV2(value)).toBe(false);
}
function boundRun(value = receipt()): RunSnapshot {
  return {
    runId: value.runId,
    status: "completed",
    startedAt: "2026-10-16T00:00:00.000Z",
    totalCases: 1,
    completedCases: 1,
    passedCases: 1,
    results: [],
    events: [],
    evidence: {
      v: 1,
      lineage: {},
      reproduction: {
        configHash: value.source.configHash,
        casesHash: digest,
        sourceHash: value.source.sourceHash,
        node: "v24",
        platform: "test",
        arch: "test",
        gitCommit: value.commit,
        gitDirty: false,
        projectPath: value.source.projectPath,
        lockfiles: {},
        environmentHash: digest,
        environmentNames: [],
        mode: "recorded",
      },
    },
  };
}
function sourceProof(value = receipt()) {
  const fingerprint = {
    commit: value.commit,
    indexHash: digest,
    trackedStatusHash: digest,
    sourceHash: value.source.sourceHash,
    trackedFilesHash: digest,
    commitMatches: true,
  };
  return {
    v: 1,
    kind: "canary.execution-source",
    runId: value.runId,
    status: "unchanged",
    projectPath: value.source.projectPath,
    before: { ...fingerprint },
    after: { ...fingerprint },
  };
}

describe("version-bound change verification", () => {
  it("accepts the same strict v2 evidence through standalone and shared readers", () => {
    const value = receipt();
    expect(changeVerificationV2Schema.parse(value)).toEqual(value);
    expect(changeVerificationSchema.parse(value)).toEqual(value);
    expect(verificationReceiptSchema.parse(value)).toEqual(value);
    expect(isChangeVerificationV2(value)).toBe(true);
  });

  it("keeps unknown dimensions independent from known zero denominators", () => {
    const unknown = measuredFile("src/unknown.ts");
    unknown.execution = {
      status: "unknown",
      lines: { covered: null, total: null },
      functions: { covered: null, total: null },
      branches: { covered: null, total: null },
      reasons: ["No coverage was recorded"],
    };
    unknown.uncovered.lines = [];
    const empty = measuredFile("src/type-only.ts");
    empty.execution = {
      status: "measured",
      lines: { covered: 0, total: 0 },
      functions: { covered: 0, total: 0 },
      branches: { covered: 0, total: 0 },
      reasons: [],
    };
    empty.uncovered.lines = [];
    const summary = deriveChangeSummary([measuredFile(), unknown, empty], source);
    expect(summary.execution).toEqual({
      lines: { covered: 1, total: 2, unknownFiles: 1 },
      functions: { covered: 1, total: 1, unknownFiles: 1 },
      branches: { covered: 0, total: 0, unknownFiles: 2 },
    });
    expect(summary.behavior).toEqual({ verified: 0, failed: 0, unknown: 3 });
    const value = receipt();
    value.files = [measuredFile(), unknown, empty];
    value.summary = summary;
    expect(changeVerificationV2Schema.safeParse(value).success).toBe(true);
  });

  it("counts behavior by file while preserving failed assertions separately from uncovered code", () => {
    const value = receipt(),
      contract = {
        id: "duplicate-invoice",
        paths: ["src/**"],
        checkId: "test",
        assertionId: "duplicate",
        required: true,
        status: "failed" as const,
        evidence: "maintainer-declared-check-and-deterministic-assertion",
        checkStatus: "failed",
      };
    value.contracts = [contract];
    value.files[0]!.contracts = [contract];
    value.files[0]!.behavior = "declared-assertion-failed";
    value.files[0]!.failureEvidence = ["failure_test"];
    value.files[0]!.execution.reasons.push("Coverage conflict between sources");
    value.summary = deriveChangeSummary(value.files, value.source);
    expect(value.summary.behavior).toEqual({ verified: 0, failed: 1, unknown: 0 });
    expect(value.summary.gaps.map((gap) => gap.kind)).toEqual([
      "uncovered-lines",
      "missing-coverage",
      "failed-contract",
      "coverage-conflict",
      "observed-failure",
    ]);
    expect(changeVerificationV2Schema.safeParse(value).success).toBe(true);
  });

  it("requires a declared assertion to mark a file behavior verified", () => {
    const value = receipt();
    value.files[0]!.behavior = "declared-assertions-verified";
    value.summary = deriveChangeSummary(value.files, source);
    reject(value);
    const contract = {
      id: "invoice",
      paths: ["src/**"],
      checkId: "test",
      assertionId: "invoice",
      required: false,
      status: "verified" as const,
      evidence: "deterministic assertion",
      checkStatus: "passed",
    };
    value.contracts = [contract];
    value.files[0]!.contracts = [contract];
    value.summary = deriveChangeSummary(value.files, source);
    expect(changeVerificationV2Schema.safeParse(value).success).toBe(true);
    value.contracts[0]!.checkStatus = "blocked";
    reject(value);
  });

  it.each(["source", "summary", "checks", "assessment", "limitations"])(
    "does not accept legacy fields as sufficient v2 evidence: %s",
    (field) => {
      const value = receipt() as Record<string, unknown>;
      delete value[field];
      reject(value);
    },
  );

  it.each(["execution", "source", "summary", "checks", "file", "contract"])(
    "rejects unknown nested fields: %s",
    (field) => {
      const value = receipt() as Record<string, any>;
      if (field === "execution") value.files[0].execution.riskScore = 1;
      else if (field === "file") value.files[0].riskScore = 1;
      else if (field === "contract")
        value.contracts.push({
          id: "a",
          paths: ["src/**"],
          checkId: "a",
          assertionId: "a",
          required: false,
          status: "unknown",
          evidence: "evidence",
          checkStatus: "missing",
          guessed: true,
        });
      else value[field].riskScore = 1;
      reject(value);
    },
  );

  it.each([
    "numerator",
    "unknown-denominator",
    "uncovered-count",
    "uncovered-path",
    "duplicate-line",
    "unknown-status",
    "negative",
    "fraction",
  ])("rejects contradictory metric evidence: %s", (change) => {
    const value = receipt(),
      file = value.files[0]!;
    if (change === "numerator") file.execution.lines.covered = 3;
    else if (change === "unknown-denominator") file.execution.lines.total = null;
    else if (change === "uncovered-count") file.uncovered.lines = [];
    else if (change === "uncovered-path") file.uncovered.lines = [5];
    else if (change === "duplicate-line") file.changedLines = [3, 3, 4];
    else if (change === "unknown-status") file.execution.status = "unknown";
    else if (change === "negative") file.execution.lines.covered = -1;
    else file.execution.lines.covered = 0.5;
    value.summary = deriveChangeSummary(value.files, source);
    reject(value);
  });

  it.each(["total", "covered", "unknown", "behavior", "gap", "checks"])(
    "rejects forged counters even with plausible measurements: %s",
    (change) => {
      const value = receipt();
      if (change === "total") value.summary.files.total++;
      else if (change === "covered") value.summary.execution.lines.covered++;
      else if (change === "unknown") value.summary.execution.branches.unknownFiles = 0;
      else if (change === "behavior") value.summary.behavior.verified++;
      else if (change === "gap") value.summary.gaps = [];
      else value.checks.executed++;
      reject(value);
    },
  );

  it("represents unavailable source honestly and rejects any measurements tied to it", () => {
    const value = receipt();
    value.source = { ...source, status: "unavailable", reasons: ["Original execution source was not preserved"] };
    value.assessment = "evidence-insufficient";
    value.summary = deriveChangeSummary(value.files, value.source);
    reject(value);
    const file = value.files[0]!;
    file.execution = {
      status: "unknown",
      lines: { covered: null, total: null },
      functions: { covered: null, total: null },
      branches: { covered: null, total: null },
      reasons: ["Source identity is unavailable"],
    };
    file.uncovered = { lines: [], functions: [], branches: [] };
    value.summary = deriveChangeSummary(value.files, value.source);
    expect(changeVerificationV2Schema.safeParse(value).success).toBe(true);
    expect(value.summary.gaps.at(-1)?.kind).toBe("source-unavailable");
    value.assessment = "analyzed";
    reject(value);
  });

  it.each(["deleted", "unsupported"] as const)("does not fabricate coverage for %s source", (status) => {
    const value = receipt(),
      file = value.files[0]!;
    file.status = status;
    value.summary = deriveChangeSummary(value.files, source);
    reject(value);
    file.changedLines = [];
    file.execution = {
      status: "unknown",
      lines: { covered: null, total: null },
      functions: { covered: null, total: null },
      branches: { covered: null, total: null },
      reasons: ["Source is unavailable"],
    };
    file.uncovered.lines = [];
    value.summary = deriveChangeSummary(value.files, source);
    expect(changeVerificationV2Schema.safeParse(value).success).toBe(true);
    expect(value.summary.files[status === "deleted" ? "deleted" : "unavailable"]).toBe(1);
    expect(value.summary.gaps[0]?.kind).toBe(status === "deleted" ? "deleted-source" : "unsupported-source");
  });

  it("retains historical v1 receipts without claiming the new evidence contract", () => {
    const legacy = {
      v: 1,
      kind: "canary.change-verification",
      runId: "run_old",
      baseline: "b".repeat(40),
      commit: "c".repeat(40),
      manifestHash: digest,
      files: [{ path: "old.ts", behavior: "unknown" }],
      contracts: [],
    };
    expect(changeVerificationSchema.parse(legacy)).toEqual(legacy);
    expect(verificationReceiptSchema.parse(legacy)).toEqual(legacy);
    expect(isChangeVerificationV2(legacy)).toBe(false);
    reject({ ...legacy, v: 2 });
    reject({ ...receipt(), v: 3 });
  });

  it.each([
    "missing-proof",
    "unresolved-reason",
    "unavailable-reason",
    "source-path",
    "file-path",
    "duplicate-file",
    "unknown-explanation",
    "checks-omitted",
  ])("rejects incomplete identity or denominator evidence: %s", (change) => {
    const value = receipt();
    if (change === "missing-proof") delete value.source.executionSourceHash;
    else if (change === "unresolved-reason") value.source.reasons = ["Not established"];
    else if (change === "unavailable-reason") {
      value.source.status = "unavailable";
      value.assessment = "evidence-insufficient";
    } else if (change === "source-path") value.source.projectPath = "../external";
    else if (change === "file-path") value.files[0]!.path = "C:\\private\\file.ts";
    else if (change === "duplicate-file") value.files.push(structuredClone(value.files[0]!));
    else if (change === "unknown-explanation") {
      value.files[0]!.execution = {
        status: "unknown",
        lines: { covered: null, total: null },
        functions: { covered: null, total: null },
        branches: { covered: null, total: null },
        reasons: [],
      };
      value.files[0]!.uncovered.lines = [];
    } else value.checks.omitted++;
    value.summary = deriveChangeSummary(value.files, value.source);
    reject(value);
  });

  it("does not transfer a verified assertion from an unrelated file or another assessment", () => {
    const value = receipt(),
      contract = {
        id: "invoice",
        paths: ["src/other.ts"],
        checkId: "test",
        assertionId: "invoice",
        required: false,
        status: "verified" as const,
        evidence: "deterministic assertion",
        checkStatus: "passed",
      };
    value.contracts = [contract];
    value.files[0]!.contracts = [contract];
    value.files[0]!.behavior = "declared-assertions-verified";
    value.summary = deriveChangeSummary(value.files, value.source);
    reject(value);
    contract.paths = ["src/**"];
    expect(changeVerificationV2Schema.safeParse(value).success).toBe(true);
    value.files[0]!.contracts = [{ ...contract, assertionId: "different-assertion" }];
    reject(value);
    value.files[0]!.contracts = [contract];
    value.contracts.push(contract);
    reject(value);
  });
  it.each(["**/*.ts", "invoice.?s"])(
    "uses the same zero-directory and single-character glob semantics for contract validation: %s",
    (pattern) => {
      const value = receipt();
      const file = value.files[0]!;
      file.path = "invoice.ts";
      const contract = {
        id: "invoice",
        paths: [pattern],
        checkId: "test",
        assertionId: "invoice",
        required: false,
        status: "verified" as const,
        evidence: "deterministic assertion",
        checkStatus: "passed",
      };
      value.contracts = [contract];
      file.contracts = [contract];
      file.behavior = "declared-assertions-verified";
      value.summary = deriveChangeSummary(value.files, value.source);
      expect(matchesBehaviorPath(file.path, pattern)).toBe(true);
      expect(changeVerificationV2Schema.safeParse(value).success).toBe(true);
      expect(matchesBehaviorPath("src/invoice.ts", "invoice.?s")).toBe(false);
    },
  );

  it("projects measurements only after binding the receipt to its run and source proof", () => {
    const value = receipt();
    expect(
      isChangeVerificationBound(value, boundRun(value), sourceProof(value), value.source.executionSourceHash),
    ).toBe(true);
  });

  it.each([
    "runId",
    "commit",
    "configHash",
    "sourceHash",
    "projectPath",
    "dirty",
    "missing-evidence",
    "missing-hash",
    "wrong-hash",
    "changed-proof",
    "wrong-proof-run",
    "wrong-proof-path",
    "wrong-proof-commit",
    "wrong-proof-source",
    "missing-fingerprint",
    "changed-index",
    "extra-proof-field",
    "missing-commit-match",
    "false-commit-match",
    "changed-commit-match",
  ])("rejects sealed but unbound or contradictory source evidence: %s", (change) => {
    const value = receipt(),
      run = boundRun(value),
      proof = sourceProof(value) as Record<string, any>;
    let hash = value.source.executionSourceHash;
    if (change === "runId") run.runId = "run_other";
    else if (change === "commit") run.evidence!.reproduction.gitCommit = "f".repeat(40);
    else if (change === "configHash") run.evidence!.reproduction.configHash = "f".repeat(64);
    else if (change === "sourceHash") run.evidence!.reproduction.sourceHash = "f".repeat(64);
    else if (change === "projectPath") run.evidence!.reproduction.projectPath = "packages/other";
    else if (change === "dirty") run.evidence!.reproduction.gitDirty = true;
    else if (change === "missing-evidence") delete run.evidence;
    else if (change === "missing-hash") hash = undefined;
    else if (change === "wrong-hash") hash = "f".repeat(64);
    else if (change === "changed-proof") proof.status = "changed";
    else if (change === "wrong-proof-run") proof.runId = "run_other";
    else if (change === "wrong-proof-path") proof.projectPath = "packages/other";
    else if (change === "wrong-proof-commit") {
      proof.before.commit = "f".repeat(40);
      proof.after.commit = "f".repeat(40);
    } else if (change === "wrong-proof-source") {
      proof.before.sourceHash = "f".repeat(64);
      proof.after.sourceHash = "f".repeat(64);
    } else if (change === "missing-fingerprint") delete proof.after.trackedFilesHash;
    else if (change === "changed-index") proof.after.indexHash = "f".repeat(64);
    else if (change === "missing-commit-match") {
      delete proof.before.commitMatches;
      delete proof.after.commitMatches;
    } else if (change === "false-commit-match") {
      proof.before.commitMatches = false;
      proof.after.commitMatches = false;
    } else if (change === "changed-commit-match") proof.after.commitMatches = false;
    else proof.claimed = true;
    expect(isChangeVerificationV2(value)).toBe(true);
    expect(isChangeVerificationBound(value, run, proof, hash)).toBe(false);
  });

  it("keeps source-unavailable reports bound to their run without upgrading them", () => {
    const value = receipt(),
      run = boundRun(value),
      file = value.files[0]!;
    value.source.status = "unavailable";
    value.source.reasons = ["Original proof is unavailable"];
    delete value.source.executionSourceHash;
    value.assessment = "evidence-insufficient";
    file.execution = {
      status: "unknown",
      lines: { covered: null, total: null },
      functions: { covered: null, total: null },
      branches: { covered: null, total: null },
      reasons: ["Source identity unavailable"],
    };
    file.uncovered.lines = [];
    value.summary = deriveChangeSummary(value.files, value.source);
    expect(isChangeVerificationBound(value, run, undefined)).toBe(true);
    value.source.executionSourceHash = "b".repeat(64);
    expect(isChangeVerificationBound(value, run, sourceProof(value), "f".repeat(64))).toBe(false);
    expect(isChangeVerificationBound(value, run, sourceProof(value), value.source.executionSourceHash)).toBe(true);
    run.runId = "run_other";
    expect(isChangeVerificationBound(value, run, undefined)).toBe(false);
  });
});
