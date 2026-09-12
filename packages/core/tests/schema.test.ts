import { describe, expect, it } from "vitest";
import { parseCanaryConfig, parseChildMessage, parseReplayRequest, parseReportFormat, parseTestCase, defineCase, defineCases, canaryExpect, SchemaValidationError, IPC_MAX_BYTES } from "../src/index.js";

describe("Zod boundary validation", () => {
  it("accepts a valid config and rejects unknown keys or missing agent entry", () => {
    const config = parseCanaryConfig({
      agent: { adapter: "function", entry: "./agent.ts" },
      cases: "./cases/**/*.ts",
      coverage: { include: ["src/**/*.ts"], lines: 80 },
    });
    expect(config.agent.entry).toBe("./agent.ts");
    expect(() => parseCanaryConfig({ agent: { adapter: "function", entry: "./agent.ts" }, cases: "./cases.ts", coverage: { include: ["src"] }, extra: true })).toThrow(SchemaValidationError);
    expect(() => parseCanaryConfig({ agent: { adapter: "function", entry: "" }, cases: "./cases.ts", coverage: { include: ["src"] } })).toThrow(/CanaryConfig/);
    expect(parseCanaryConfig({
      agent: { adapter: "mcp", entry: "./servers/mcp-agent.ts" },
      cases: "./cases.ts",
      coverage: { include: ["src"] },
      tools: { adapter: "mcp-stdio", command: "node", args: ["./servers/mcp-tools.ts"] },
      model: { provider: "deterministic" },
      runtime: { concurrency: 2 },
    }).runtime?.concurrency).toBe(2);
  });

  it("requires TestCase id and input, and does not swallow invalid cases", () => {
    expect(parseTestCase({ id: "smoke", input: { q: 1 } }).id).toBe("smoke");
    expect(() => parseTestCase({ id: 1, input: "x" })).toThrow(/TestCase/);
    expect(() => parseTestCase({ id: "smoke" })).toThrow(/input/);
  });

  it("compiles defineCase DSL assertions to underlying AssertionSpec types", () => {
    const testCase = defineCase({
      id: "agent-recovers-from-tool-error",
      input: "retry",
      expectedFeatures: ["error-recovery"],
      assertions: [
        canaryExpect.output().exists(),
        canaryExpect.trajectory().hasNoLoop(),
        canaryExpect.trajectory().maxSteps(12),
        canaryExpect.coverage().feature("error-recovery").atLeast(60),
        canaryExpect.judge().score({ minScore: 0.7, minConfidence: 0.5 }),
      ],
    });
    expect(testCase.assertions?.map((item) => item.type)).toEqual([
      "output.exists",
      "trajectory.forbidden_event",
      "trajectory.max_steps",
      "coverage.atLeast",
      "judge.score",
    ]);
    expect(defineCases([testCase])).toHaveLength(1);
    expect(() => defineCase({ id: "bad" } as never)).toThrow(/input/);
  });

  it("parses IPC messages and fails fast on unknown envelopes", () => {
    expect(parseChildMessage({ v: 1, type: "result", value: { ok: true } }).type).toBe("result");
    expect(parseChildMessage({ v: 1, type: "event", event: { type: "tool_call", timestamp: "2026-01-01T00:00:00.000Z" } }).type).toBe("event");
    expect(() => parseChildMessage({ type: "result", value: { ok: true } })).toThrow(/IPC payload/);
    expect(() => parseChildMessage({ v: 2, type: "result", value: { ok: true } })).toThrow(/IPC payload/);
    expect(() => parseChildMessage({ type: "nope" })).toThrow(/IPC payload/);
    expect(() => parseChildMessage({ v: 1, type: "error" })).toThrow(/IPC payload/);
    expect(() => parseChildMessage({ v: 1, type: "result", value: "x".repeat(IPC_MAX_BYTES) })).toThrow(/exceeds/);
  });

  it("rejects invalid replay bodies and report formats instead of defaulting", () => {
    expect(parseReplayRequest({})).toEqual({});
    expect(parseReplayRequest({ caseId: "smoke" }).caseId).toBe("smoke");
    expect(() => parseReplayRequest({ caseId: "smoke", extra: true })).toThrow(/replay/);
    expect(parseReportFormat("junit")).toBe("junit");
    expect(parseReportFormat("console")).toBe("console");
    expect(() => parseReportFormat("html")).toThrow(/report format/);
  });
});
