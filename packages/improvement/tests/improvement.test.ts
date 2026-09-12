import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareRuns, decideSuggestion, proposeFromResults, writeRegressionDrafts } from "../src/index.js";
import type { EvalResult } from "@canary/core";

const coverage = { runId: "r", sourceHash: "h", status: "final" as const, lines: { covered: 1, total: 2, pct: 50 }, statements: { covered: 1, total: 2, pct: 50 }, functions: { covered: 1, total: 1, pct: 100 }, branches: { covered: 0, total: 1, pct: 0 }, featureChains: [{ featureId: "planning", name: "Planning", status: "uncovered" as const, caseIds: [], expectedCaseIds: [], failedCaseIds: [], filePaths: [], coverage: { covered: 0, total: 1, pct: 0 }, uncoveredLocations: [] }] };
const evalResult = (caseId: string, passed: boolean): EvalResult => ({
  runId: "run_a", executionId: "e", caseId, passed, assertions: [{ id: "output.exists", passed, message: passed ? undefined : "missing output" }], coverage, failureCategory: passed ? undefined : "assertion_failed",
});

describe("improvement loop", () => {
  it("exports suggestions from failed cases without modifying source", () => {
    const suggestions = proposeFromResults("run_a", [evalResult("ok", true), evalResult("bad", false)]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.status).toBe("proposed");
    expect(suggestions[0]?.evidence.length).toBeGreaterThan(0);
    expect(suggestions[0]?.proposedCase?.id).toBe("bad.regression");
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

  it("writes regression case drafts without touching Agent source", () => {
    const suggestions = proposeFromResults("run_a", [evalResult("bad", false)]);
    const outDir = mkdtempSync(join(tmpdir(), "canary-regression-"));
    const [file] = writeRegressionDrafts(suggestions, outDir);
    const text = readFileSync(file!, "utf8");
    expect(text).toContain("bad.regression");
    expect(text).toContain("proposed");
    expect(text).not.toContain("runAgent");
  });

  it("keeps human approval: verified requires accepted", () => {
    const [suggestion] = proposeFromResults("run_a", [evalResult("bad", false)]);
    expect(() => decideSuggestion(suggestion!, "verified")).toThrow(/accepted/);
    expect(decideSuggestion(suggestion!, "rejected").status).toBe("rejected");
  });
});
