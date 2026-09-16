import { describe, expect, it } from "vitest";
import { evaluateAgent, evaluateCoverageGates, evaluateHardGates, mergeQualityGates, exitCodeForRun, attributeFailure, DeterministicJudgeProvider, HttpJudgeProvider } from "../src/index.js";
import type { CoverageSummary, EvalResult, Trajectory } from "@canary/core";

const trajectory = (events: Trajectory["events"], termination: Trajectory["termination"] = "completed"): Trajectory => ({
  id: "t1", runId: "r1", caseId: "c1", events, stepCount: 3, termination,
});

const event = (type: string, extra: Record<string, unknown> = {}) => ({ type, timestamp: new Date().toISOString(), ...extra });

describe("deterministic Agent evaluator", () => {
  it("evaluates output existence, schema and predicate", async () => {
    const schema = { safeParse: (value: unknown) => ({ success: typeof value === "object" && value !== null }) };
    const result = await evaluateAgent({ output: { ok: true }, assertions: [
      { type: "output.exists" }, { type: "output.schema", schema },
      { type: "output.predicate", predicate: (value) => (value as { ok: boolean }).ok },
    ] });
    expect(result.passed).toBe(true);
    expect(result.assertions).toHaveLength(3);
  });

  it("checks trajectory events, limits, termination and recovery", async () => {
    const result = await evaluateAgent({ trajectory: trajectory([
      event("error"), event("recovery"), event("tool.call"), event("required"),
    ]), assertions: [
      { type: "trajectory.required_event", event: "required" },
      { type: "trajectory.forbidden_event", event: "forbidden" },
      { type: "trajectory.max_steps", max: 3 },
      { type: "trajectory.max_tool_calls", max: 1 },
      { type: "execution.termination", expected: "completed" },
      { type: "trajectory.error_recovery" },
    ] });
    expect(result.passed).toBe(true);
  });

  it("fails latency, budget and feature assertions deterministically", async () => {
    const result = await evaluateAgent({
      context: { latencyMs: 101, budgetUsed: 12, expectedFeatures: ["search"], featureStatuses: { search: "uncovered" } },
      assertions: [
        { type: "execution.max_latency", maxMs: 100 },
        { type: "execution.max_budget", max: 10 },
        { type: "feature.expected", featureId: "search" },
      ],
    });
    expect(result.passed).toBe(false);
    expect(result.assertions.every((item) => item.passed)).toBe(false);
  });

  it("supports parse-only schemas and reports unsupported assertions", async () => {
    const result = await evaluateAgent({ output: "ok", assertions: [
      { type: "output.schema", schema: { parse: (value: unknown) => { if (value !== "ok") throw new Error("bad"); return value; } } },
      { type: "unknown.assertion" },
    ] });
    expect(result.passed).toBe(false);
    expect(result.diagnostics?.[0]).toContain("Unsupported assertion");
  });

  it("evaluates dedicated tool name, args, order and state assertions", async () => {
    const result = await evaluateAgent({
      context: { state: { lastTool: "lookup", lastResult: "found:alpha" } },
      trajectory: trajectory([
        event("tool.call", { name: "parse", args: { text: "a b" } }),
        event("tool.call", { name: "compute", args: { tokens: ["a", "b"] } }),
        event("tool.call", { name: "lookup", args: { q: "alpha" } }),
        event("tool_call", { name: "lookup", args: { q: "ignored-duplicate" } }),
      ]),
      assertions: [
        { type: "tool.called", name: "lookup" },
        { type: "tool.args", name: "lookup", contains: { q: "alpha" } },
        { type: "tool.order", names: ["parse", "compute"] },
        { type: "state.has", key: "lastTool" },
        { type: "state.equals", key: "lastTool", value: "lookup" },
        { type: "state.contains", contains: { lastResult: "found:alpha" } },
      ],
    });
    expect(result.passed).toBe(true);

    const failed = await evaluateAgent({
      context: { state: { other: 1 } },
      trajectory: trajectory([event("tool_call", { name: "lookup", args: { q: "alpha" } })]),
      assertions: [
        { type: "tool.called", name: "lookup" },
        { type: "state.has", key: "lastTool" },
      ],
    });
    expect(failed.passed).toBe(false);
    expect(failed.assertions.find((item) => item.id.startsWith("tool.called"))?.passed).toBe(false);
    expect(failed.assertions.find((item) => item.id.startsWith("state.has"))?.passed).toBe(false);
  });
});

const coverage = (status: CoverageSummary["status"], pct = 90): CoverageSummary => ({
  runId: "r", sourceHash: "h", status,
  lines: { covered: pct, total: 100, pct }, statements: { covered: pct, total: 100, pct },
  functions: { covered: pct, total: 100, pct }, branches: { covered: pct, total: 100, pct },
  featureChains: [{ featureId: "planning", name: "Planning", status: "partial", caseIds: [], expectedCaseIds: [], failedCaseIds: [], filePaths: [], coverage: { covered: 8, total: 10, pct: 80 }, uncoveredLocations: [] }],
});

describe("coverage / feature gates", () => {
  it("passes when no thresholds are configured, even if coverage is unavailable", () => {
    expect(evaluateCoverageGates(undefined, {}).passed).toBe(true);
  });

  it("fails required coverage when status is unavailable or partial", () => {
    expect(evaluateCoverageGates(undefined, { lines: 80 }).failures[0]?.code).toBe("unavailable");
    expect(evaluateCoverageGates(coverage("unavailable"), { lines: 80 }).passed).toBe(false);
    expect(evaluateCoverageGates(coverage("preparing"), { lines: 80 }).passed).toBe(false);
    expect(evaluateCoverageGates(coverage("partial", 99), { lines: 80 }).passed).toBe(false);
    expect(evaluateCoverageGates(coverage("final", 79), { lines: 80 }).failures[0]?.code).toBe("below_threshold");
    expect(evaluateCoverageGates(coverage("final", 80), { lines: 80, branches: 70, functions: 75 }).passed).toBe(true);
  });

  it("fails a required feature that is unavailable, and compares feature pct otherwise", () => {
    const missing = coverage("final", 90);
    missing.featureChains = [];
    expect(evaluateCoverageGates(missing, { featureChains: { planning: 70 } }).failures[0]?.code).toBe("feature_unavailable");
    const partialPass = evaluateCoverageGates(coverage("final", 90), { featureChains: { planning: 70 } });
    expect(partialPass.passed).toBe(true);
    expect(partialPass.featureChainSemantics).toEqual({ mode: "source_pct", partialDoesNotFail: true });
    expect(coverage("final", 90).featureChains[0]?.status).toBe("partial");
    const partialFail = evaluateCoverageGates(coverage("final", 90), { featureChains: { planning: 90 } });
    expect(partialFail.passed).toBe(false);
    expect(partialFail.featureChainSemantics).toEqual({ mode: "source_pct", partialDoesNotFail: true });
  });

  it("shares the CI exit rule: failed run, failed gate, or JUnit failures all return 1", () => {
    expect(exitCodeForRun({ runFailed: false, gatePassed: true, junitFailures: 0 })).toBe(0);
    expect(exitCodeForRun({ runFailed: true, gatePassed: true, junitFailures: 0 })).toBe(1);
    expect(exitCodeForRun({ runFailed: false, gatePassed: false, junitFailures: 0 })).toBe(1);
    expect(exitCodeForRun({ runFailed: false, gatePassed: true, junitFailures: 2 })).toBe(1);
  });

  it("fails the hard gate on unexpected policy violations and unexpected loops", () => {
    const result: EvalResult = {
      runId: "r", executionId: "e", caseId: "leaky", passed: true,
      assertions: [{ id: "output.exists", passed: true }],
      coverage: coverage("final", 90),
      trajectory: trajectory([event("policy.violation", { rule: "no-exfil" })]),
    };
    const hard = evaluateHardGates({ results: [result], coverage: coverage("final", 90), coreFeatures: ["planning"] });
    expect(hard.passed).toBe(false);
    expect(hard.policyViolations).toBe(1);
    const merged = mergeQualityGates(evaluateCoverageGates(coverage("final", 90), { lines: 80 }), hard);
    expect(merged.passed).toBe(false);
    expect(merged.reason).toBe("hard_gate_failed");
    const expectedLoop: EvalResult = {
      ...result, caseId: "loop-ok",
      assertions: [{ id: "trajectory.required_event#1", passed: true, details: { event: "loop_detected" } }],
      trajectory: trajectory([event("loop_detected")]),
    };
    expect(evaluateHardGates({ results: [expectedLoop], coverage: coverage("final", 90) }).passed).toBe(true);
    const unexpectedOnSibling: EvalResult = {
      ...result, caseId: "leaky-2",
      assertions: [{ id: "output.exists", passed: true }],
      trajectory: trajectory([event("policy.violation")]),
    };
    expect(evaluateHardGates({ results: [expectedLoop, unexpectedOnSibling], coverage: coverage("final", 90) }).passed).toBe(false);
  });

  it("attributes wrong_output vs policy_violation", async () => {
    const outputFail = await evaluateAgent({ output: null, assertions: [{ type: "output.exists" }] });
    const attributed = attributeFailure({
      runId: "r", executionId: "e", caseId: "c", passed: false,
      assertions: outputFail.assertions, coverage: coverage("final", 90),
    });
    expect(attributed.kind).toBe("wrong_output");
    expect(attributed.category).toBe("prompt");
    expect(
      attributeFailure({
        runId: "r",
        executionId: "e",
        caseId: "c",
        passed: false,
        assertions: [{ id: "agent.completed", passed: false, message: "budget" }],
        coverage: coverage("partial", 10),
        trajectory: trajectory([], "budget_exceeded"),
      }).kind,
    ).toBe("budget_exceeded");
  });
});

describe("coverage.atLeast and LLM-as-Judge", () => {
  it("passes coverage.atLeast when the feature pct meets the threshold", async () => {
    const passed = await evaluateAgent({
      context: { coverage: coverage("final", 90) },
      assertions: [{ type: "coverage.atLeast", featureId: "planning", minPct: 60 }],
    });
    expect(passed.passed).toBe(true);
    const failed = await evaluateAgent({
      context: { coverage: coverage("final", 90) },
      assertions: [{ type: "coverage.atLeast", featureId: "planning", minPct: 90 }],
    });
    expect(failed.passed).toBe(false);
    const missing = await evaluateAgent({
      assertions: [{ type: "coverage.atLeast", featureId: "planning", minPct: 60 }],
    });
    expect(missing.passed).toBe(false);
  });

  it("never treats judge error, timeout, or low confidence as a pass", async () => {
    const errored = await evaluateAgent({
      output: { ok: true },
      context: { judge: new DeterministicJudgeProvider({ verdict: "error" }) },
      assertions: [{ type: "judge.score", minScore: 0.1, minConfidence: 0.1 }],
    });
    expect(errored.passed).toBe(false);
    expect(errored.assertions[0]?.details).toMatchObject({ verdict: "error" });

    const timedOut = await evaluateAgent({
      output: { ok: true },
      context: { judge: new DeterministicJudgeProvider({ delayMs: 40 }) },
      assertions: [{ type: "judge.score", minScore: 0.1, timeoutMs: 5 }],
    });
    expect(timedOut.passed).toBe(false);
    expect((timedOut.assertions[0]?.details as { verdict?: string }).verdict).toBe("timeout");

    const low = await evaluateAgent({
      output: { ok: true },
      context: { judge: new DeterministicJudgeProvider({ verdict: "low_confidence" }) },
      assertions: [{ type: "judge.score", minScore: 0.1, minConfidence: 0.8 }],
    });
    expect(low.passed).toBe(false);
    expect((low.assertions[0]?.details as { verdict?: string }).verdict).toBe("low_confidence");

    const ok = await evaluateAgent({
      output: { ok: true },
      context: { judge: new DeterministicJudgeProvider({ verdict: "pass", score: 0.9 }) },
      assertions: [{ type: "judge.score", minScore: 0.5, minConfidence: 0.5 }],
    });
    expect(ok.passed).toBe(true);

    const missing = await evaluateAgent({
      output: { ok: true },
      assertions: [{ type: "judge.score", minScore: 0.5, minConfidence: 0.5 }],
    });
    expect(missing.passed).toBe(false);
    expect(missing.assertions[0]?.message).toMatch(/Required Judge provider is missing/);

    const optional = await evaluateAgent({
      output: { ok: true },
      assertions: [{ type: "judge.score", required: false, minScore: 0.5 }],
    });
    expect(optional.passed).toBe(true);
    expect(optional.assertions[0]?.details).toMatchObject({ status: "skipped" });

    const stub = new DeterministicJudgeProvider();
    expect((await stub.score({ input: "x", output: { ok: true } })).verdict).toBe("error");

    const http = new HttpJudgeProvider("https://judge.example/score", (async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    })) as typeof fetch);
    expect((await http.score({ input: "x", output: "y" })).verdict).toBe("error");
  });

  it("aborts an in-flight HTTP judge request instead of only stopping the waiter", async () => {
    const { createServer } = await import("node:http");
    let aborted = false;
    const server = createServer((request, response) => {
      request.on("aborted", () => { aborted = true; });
      request.on("close", () => { if (!response.writableEnded) aborted = true; });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    try {
      const judge = new HttpJudgeProvider(`http://127.0.0.1:${port}/score`);
      const scored = await judge.score({ input: "x", output: "y", timeoutMs: 30 });
      expect(scored.verdict).toBe("timeout");
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(aborted).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("evaluator registry and judge composition", () => {
  it("registers the deterministic evaluator without changing assertion semantics", async () => {
    const { defaultEvaluatorRegistry, createJudgeProvider } = await import("../src/index.js");
    const listed = defaultEvaluatorRegistry.list().map((item) => item.id);
    expect(listed).toContain("canary.deterministic-agent");
    const evaluated = await defaultEvaluatorRegistry.evaluate("canary.deterministic-agent", {
      output: { ok: true },
      assertions: [{ type: "output.exists" }],
    });
    expect(evaluated.passed).toBe(true);
    expect(() => createJudgeProvider({ provider: "http", url: "http://127.0.0.1/score" })).toThrow(/allowOutbound/);
    const stub = createJudgeProvider({ provider: "deterministic" });
    expect(stub.stub).toBe(true);
    expect((await stub.score({ input: "x", output: "y" })).verdict).toBe("pass");
  });
});
