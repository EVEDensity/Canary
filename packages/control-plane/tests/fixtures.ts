import type { RunSnapshot } from "@canary/core";
export function fixtureRun(id = "baseline", failures = 0, score?: number): RunSnapshot {
  const results = Array.from({ length: 100 }, (_, i) => ({
    runId: id,
    executionId: `e${i}`,
    caseId: `case${i}`,
    passed: i >= failures,
    coverage: {
      runId: id,
      sourceHash: "fixture",
      status: "final" as const,
      lines: { covered: 1, total: 1, pct: 100 },
      statements: { covered: 1, total: 1, pct: 100 },
      functions: { covered: 1, total: 1, pct: 100 },
      branches: { covered: 1, total: 1, pct: 100 },
      featureChains: [],
    },
    assertions:
      score === undefined
        ? []
        : [{ id: "judge.score#1", passed: true, details: { provider: "fixture-judge", verdict: "pass", score } }],
    sourceCase: {
      id: `case${i}`,
      input: `synthetic-${i}`,
      tags: i === 99 ? ["holdout"] : [],
      assertions: score === undefined ? [] : [{ type: "judge.score" }],
    },
  }));
  return {
    runId: id,
    status: "completed",
    startedAt: `2026-09-14T${id === "baseline" ? "00" : "01"}:00:00.000Z`,
    totalCases: 100,
    completedCases: 100,
    passedCases: 100 - failures,
    results,
    events: [],
  };
}
