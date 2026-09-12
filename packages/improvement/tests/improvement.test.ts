import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareRuns, decideSuggestion, exitCodeForComparison, proposeFromResults, serializeAssertion, writeRegressionDrafts } from "../src/index.js";
import type { EvalResult } from "@canary/core";

const coverage = { runId: "r", sourceHash: "h", status: "final" as const, lines: { covered: 1, total: 2, pct: 50 }, statements: { covered: 1, total: 2, pct: 50 }, functions: { covered: 1, total: 1, pct: 100 }, branches: { covered: 0, total: 1, pct: 0 }, featureChains: [{ featureId: "planning", name: "Planning", status: "uncovered" as const, caseIds: [], expectedCaseIds: [], failedCaseIds: [], filePaths: [], coverage: { covered: 0, total: 1, pct: 0 }, uncoveredLocations: [] }] };
const evalResult = (caseId: string, passed: boolean, extra: Partial<EvalResult> = {}): EvalResult => ({
  runId: "run_a", executionId: "e", caseId, passed, assertions: [{ id: "output.exists", passed, message: passed ? undefined : "missing output" }], coverage, failureCategory: passed ? undefined : "assertion_failed",
  sourceCase: extra.sourceCase ?? { id: caseId, input: caseId === "holdout-planning" ? "holdout" : caseId, tags: caseId.includes("holdout") ? ["holdout"] : [], assertions: [{ type: "output.exists" }] },
  ...extra,
});

describe("improvement loop", () => {
  it("exports suggestions from failed cases without modifying source", () => {
    const suggestions = proposeFromResults("run_a", [evalResult("ok", true), evalResult("bad", false)]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.status).toBe("proposed");
    expect(suggestions[0]?.evidence.length).toBeGreaterThan(0);
    expect(suggestions[0]?.proposedCase?.id).toBe("bad.regression");
    expect(suggestions[0]?.proposedCase?.input).toBe("bad");
    expect(suggestions[0]?.proposedCase?.assertions).toEqual([{ type: "output.exists" }]);
    expect(suggestions[0]?.generation?.status).toBe("ok");
    expect(suggestions[0]?.kind).toBe("wrong_output");
    expect(suggestions[0]?.evidence.some((item) => item.type === "assertion")).toBe(true);
  });

  it("rejects a candidate that regresses a passing baseline case", () => {
    const comparison = compareRuns(
      { runId: "base", results: [evalResult("safe", true), evalResult("holdout-planning", true)], coverage },
      { runId: "cand", results: [evalResult("safe", false), evalResult("holdout-planning", true)], coverage: { ...coverage, lines: { covered: 2, total: 2, pct: 100 } } },
      ["holdout-planning"],
    );
    expect(comparison.verdict).toBe("reject");
    expect(comparison.regressions).toContain("safe");
  });

  it("rejects a candidate that fails holdout even when other cases stay green", () => {
    const comparison = compareRuns(
      { runId: "base", results: [evalResult("safe", true), evalResult("holdout-planning", true)], coverage },
      { runId: "cand", results: [evalResult("safe", true), evalResult("holdout-planning", false)], coverage },
    );
    expect(comparison.verdict).toBe("reject");
    expect(comparison.regressions).toContain("holdout:holdout-planning");
  });

  it("does not treat an id substring as holdout without tags or dataset.split", () => {
    const named = evalResult("holdout-looking", true, { sourceCase: { id: "holdout-looking", input: "x", tags: [], assertions: [{ type: "output.exists" }] } });
    const comparison = compareRuns(
      { runId: "base", results: [named], coverage },
      { runId: "cand", results: [{ ...named, passed: false, failureCategory: "assertion_failed" }], coverage },
    );
    expect(comparison.regressions.some((id) => id.startsWith("holdout:"))).toBe(false);
    expect(comparison.verdict).toBe("reject");
  });

  it("marks missing baseline passing cases as incomparable instead of improve", () => {
    const comparison = compareRuns(
      { runId: "base", results: [evalResult("one", true), evalResult("two", false)], coverage },
      { runId: "cand", results: [evalResult("two", true)], coverage },
    );
    expect(comparison.verdict).toBe("incomparable");
    expect(comparison.completeness.missingBaselinePassing).toContain("one");
    expect(comparison.improvements).toContain("two");
    expect(exitCodeForComparison(comparison)).toBe(1);
  });

  it("does not hide a failed trial behind a later passing trial of the same case", () => {
    const comparison = compareRuns(
      { runId: "base", results: [evalResult("one", true, { repetition: 1 }), evalResult("one", true, { repetition: 2 })], coverage },
      { runId: "cand", results: [evalResult("one", false, { repetition: 1 }), evalResult("one", true, { repetition: 2 })], coverage },
    );
    expect(comparison.verdict).toBe("reject");
    expect(comparison.regressions).toContain("one#1");
  });

  it("does not treat missing coverage as a 0 delta", () => {
    const comparison = compareRuns(
      { runId: "base", results: [evalResult("safe", true)], coverage },
      { runId: "cand", results: [evalResult("safe", true)], coverage: { ...coverage, status: "unavailable" } },
    );
    expect(comparison.coverageDelta.comparable).toBe(false);
    expect(comparison.coverageDelta.lines).toBeUndefined();
    expect(comparison.verdict).toBe("keep");
    expect(comparison.admission.quality.comparable).toBe(false);
  });

  it("does not admit when a high judge score sits next to a hard-gate failure", () => {
    const comparison = compareRuns(
      { runId: "base", results: [evalResult("safe", false)], coverage },
      {
        runId: "cand",
        results: [evalResult("safe", true)],
        coverage,
        gate: { passed: false, reason: "hard_gate_failed", failures: [{ code: "policy_violation", target: "safe", message: "unexpected policy" }], hardGate: { passed: false, policyViolations: 1, unexpectedLoops: 0, stateFailures: 0, unavailableCoreFeatures: [] } },
      },
    );
    expect(comparison.verdict).toBe("improve");
    expect(comparison.admission.verdict).toBe("reject");
    expect(exitCodeForComparison(comparison)).toBe(1);
  });

  it("refuses to forge drafts from output or non-serializable assertions", () => {
    const missingInput = proposeFromResults("run_a", [evalResult("bad", false, { sourceCase: undefined, input: undefined })]);
    expect(missingInput[0]?.generation?.status).toBe("unavailable");
    expect(missingInput[0]?.proposedCase).toBeUndefined();
    const predicate = proposeFromResults("run_a", [evalResult("bad", false, { sourceCase: { id: "bad", input: "x", assertions: [{ type: "output.predicate", predicate: () => true }] } })]);
    expect(predicate[0]?.generation?.status).toBe("unavailable");
    expect(serializeAssertion({ type: "tool.args", name: "lookup", contains: { q: "alpha" } }).ok).toBe(true);
  });

  it("writes regression case drafts without touching Agent source", () => {
    const suggestions = proposeFromResults("run_a", [evalResult("bad", false)]);
    const outDir = mkdtempSync(join(tmpdir(), "canary-regression-"));
    const [file] = writeRegressionDrafts(suggestions, outDir);
    const text = readFileSync(file!, "utf8");
    expect(text).toContain("bad.regression");
    expect(text).toContain("\"input\": \"bad\"");
    expect(text).toContain("output.exists");
    expect(text).toContain("proposed");
    expect(text).not.toContain("runAgent");
  });

  it("keeps human approval: verified requires accepted", () => {
    const [suggestion] = proposeFromResults("run_a", [evalResult("bad", false)]);
    expect(() => decideSuggestion(suggestion!, "verified")).toThrow(/accepted/);
    expect(decideSuggestion(suggestion!, "rejected").status).toBe("rejected");
    const accepted = decideSuggestion(suggestion!, "accepted");
    expect(decideSuggestion(accepted, "verified").status).toBe("verified");
    expect(() => decideSuggestion(decideSuggestion(accepted, "verified"), "proposed")).toThrow(/immutable/);
  });
});
