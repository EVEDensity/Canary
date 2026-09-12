import { describe, expect, it } from "vitest";
import { parseCanaryConfig, parseChildMessage, parseReplayRequest, parseReportFormat, parseTestCase, SchemaValidationError } from "../src/index.js";

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
  });

  it("requires TestCase id and input, and does not swallow invalid cases", () => {
    expect(parseTestCase({ id: "smoke", input: { q: 1 } }).id).toBe("smoke");
    expect(() => parseTestCase({ id: 1, input: "x" })).toThrow(/TestCase/);
    expect(() => parseTestCase({ id: "smoke" })).toThrow(/input/);
  });

  it("parses IPC messages and fails fast on unknown envelopes", () => {
    expect(parseChildMessage({ type: "result", value: { ok: true } }).type).toBe("result");
    expect(parseChildMessage({ type: "event", event: { type: "tool_call", timestamp: "2026-01-01T00:00:00.000Z" } }).type).toBe("event");
    expect(() => parseChildMessage({ type: "nope" })).toThrow(/IPC payload/);
    expect(() => parseChildMessage({ type: "error" })).toThrow(/IPC payload/);
  });

  it("rejects invalid replay bodies and report formats instead of defaulting", () => {
    expect(parseReplayRequest({})).toEqual({});
    expect(parseReplayRequest({ caseId: "smoke" }).caseId).toBe("smoke");
    expect(() => parseReplayRequest({ caseId: "smoke", extra: true })).toThrow(/replay/);
    expect(parseReportFormat("junit")).toBe("junit");
    expect(() => parseReportFormat("html")).toThrow(/report format/);
  });
});
