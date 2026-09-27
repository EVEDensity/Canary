import { describe, expect, it } from "vitest";
import type { EvalResult, ProjectCheckResult, RunSnapshot } from "@canary/core";
import { assessAgentComparison, assessProjectComparison, compareRuns } from "../src/index.js";

const coverage = { status: "unavailable" } as EvalResult["coverage"];
function result(
  id: string,
  passed: boolean,
  assertion: "state.equals" | "judge.score" | "output.exists" = "state.equals",
): EvalResult {
  return {
    runId: "source",
    executionId: id,
    caseId: id,
    passed,
    coverage,
    assertions: [{ id: `${assertion}#1`, passed }],
    sourceCase: {
      id,
      input: id,
      assertions: assertion === "state.equals" ? [{ type: assertion, value: { done: true } }] : [{ type: assertion }],
    },
  };
}
function agent(id: string, results: EvalResult[]): RunSnapshot {
  return {
    runId: id,
    status: "completed",
    startedAt: id === "after" ? "2026-09-25T00:01:00.000Z" : "2026-09-25T00:00:00.000Z",
    totalCases: results.length,
    completedCases: results.length,
    passedCases: results.filter((item) => item.passed).length,
    results,
    events: [],
  };
}
function check(id: string, status: "passed" | "failed"): ProjectCheckResult {
  return {
    id,
    version: 1,
    type: "command",
    required: true,
    status,
    evidence: "verified",
    category: status === "passed" ? "none" : "assertion",
    exitCode: status === "passed" ? 0 : 1,
    retryable: true,
    durationMs: 1,
    cwd: ".",
    envAllowlist: [],
  };
}
function project(id: string, checks: ProjectCheckResult[]): RunSnapshot {
  return {
    ...agent(id, []),
    checks,
    totalCases: checks.length,
    completedCases: checks.length,
    passedCases: checks.filter((item) => item.status === "passed").length,
  };
}

describe("R9 comparison evidence assessment", () => {
  it("shows evidence insufficient for a single deterministic improvement", () => {
    const before = agent("before", [result("task", false)]),
      after = agent("after", [result("task", true)]);
    const assessment = assessAgentComparison(before, after, compareRuns(before, after));
    expect(assessment).toMatchObject({
      level: "insufficient",
      method: "deterministic",
      sample: { matched: 1 },
      changes: { improvements: 1, regressions: 0 },
    });
    expect(assessment.uncertainty.join(" ")).toMatch(/样本/);
  });

  it("does not call output-exists or an uncalibrated judge a trusted task result", () => {
    for (const assertion of ["output.exists", "output.schema", "tool.called", "judge.score"] as const) {
      const before = agent(
        "before",
        Array.from({ length: 5 }, (_, index) => result(`task${index}`, false, assertion)),
      );
      const after = agent(
        "after",
        Array.from({ length: 5 }, (_, index) => result(`task${index}`, true, assertion)),
      );
      const assessment = assessAgentComparison(before, after, compareRuns(before, after));
      expect(assessment.level).toBe("insufficient");
      if (assertion === "judge.score") expect(assessment.method).toBe("judge-uncalibrated");
    }
  });

  it("does not trust a predicate whose implementation and captured values are absent from saved evidence", () => {
    const before = agent("before", Array.from({ length: 5 }, (_, index) => result(`task${index}`, false)));
    const after = agent("after", Array.from({ length: 5 }, (_, index) => result(`task${index}`, true)));
    for (const run of [before, after])
      for (const item of run.results) {
        item.sourceCase!.assertions = [{ type: "output.predicate" }];
        item.assertions = [{ id: "output.predicate#1", passed: item.passed }];
      }
    const assessment = assessAgentComparison(before, after, compareRuns(before, after));
    expect(assessment.level).toBe("insufficient");
    expect(assessment.uncertainty.join(" ")).toMatch(/谓词/);
  });

  it("reports paired deterministic observations while refusing changed case identity", () => {
    const before = agent(
      "before",
      Array.from({ length: 5 }, (_, index) => result(`task${index}`, index > 0)),
    );
    const after = agent(
      "after",
      Array.from({ length: 5 }, (_, index) => result(`task${index}`, true)),
    );
    expect(assessAgentComparison(before, after, compareRuns(before, after))).toMatchObject({
      level: "observed",
      changes: { improvements: 1, regressions: 0 },
      sample: { matched: 5 },
    });
    after.results[0]!.sourceCase!.input = "different task";
    expect(assessAgentComparison(before, after, compareRuns(before, after)).level).toBe("insufficient");
  });

  it("marks a linked retry subset as scoped evidence rather than a whole-project fix", () => {
    const before = project("before", [check("build", "passed"), check("test", "failed")]);
    const after = project("after", [check("test", "passed")]);
    const assessment = assessProjectComparison(before, after, { sealed: true, samePlan: false, linkedRetry: true });
    expect(assessment).toMatchObject({
      level: "insufficient",
      scope: "retry-subset",
      changes: { improvements: 1, missing: 1 },
    });
    expect(assessment.uncertainty.join(" ")).toMatch(/不能代表全项目/);
  });

  it("reports a verified full-plan regression without treating the regression itself as uncertainty", () => {
    const ids = ["build", "typecheck", "lint", "format", "test", "agent"];
    const before = project(
      "before",
      ids.map((id) => check(id, "passed")),
    );
    const after = project(
      "after",
      ids.map((id) => check(id, id === "test" ? "failed" : "passed")),
    );
    const assessment = assessProjectComparison(before, after, { sealed: true, samePlan: true, linkedRetry: false });
    expect(assessment).toMatchObject({ level: "observed", scope: "full", changes: { regressions: 1 } });
    expect(assessment.interpretation).toMatch(/发现回归/);
    expect(assessProjectComparison(after, before, { sealed: true, samePlan: true, linkedRetry: false }).level).toBe(
      "insufficient",
    );
  });
});
