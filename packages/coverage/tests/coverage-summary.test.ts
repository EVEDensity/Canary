import { describe, expect, it } from "vitest";
import { metric, summarizeCoverage } from "../src/index.js";

const source = `function one(value) {\n  if (value) return true;\n  return false;\n}\nfunction two() { throw new Error("x"); }\n`;
const script = { url: "file:///workspace/fixture.js", functions: [
  { functionName: "one", ranges: [{ startOffset: 0, endOffset: 80, count: 1 }] },
  { functionName: "two", ranges: [{ startOffset: 81, endOffset: source.length, count: 0 }] }
] };

describe("coverage summary pure functions", () => {
  it("calculates bounded metrics", () => expect(metric(4, 2)).toEqual({ covered: 2, total: 2, pct: 100 }));
  it("counts branch and function units", () => {
    const summary = summarizeCoverage("run_fixture", [script], { rootDir: "/workspace", include: ["fixture.js"], sourceText: () => source });
    expect(summary.functions).toEqual({ covered: 1, total: 2, pct: 50 });
    expect(summary.branches.total).toBe(2);
    expect(summary.lines.total).toBeGreaterThan(0);
  });
  it("keeps explicitly included unloaded files in denominator", () => {
    const summary = summarizeCoverage("run_empty", [], { rootDir: "/workspace", include: ["fixture.js"], sourceText: () => source });
    expect(summary.status).toBe("final"); expect(summary.lines.total).toBeGreaterThan(0); expect(summary.lines.covered).toBe(0); expect(summary.lines.pct).toBe(0);
  });
  it("filters excluded files", () => {
    const summary = summarizeCoverage("run_excluded", [script], { rootDir: "/workspace", include: ["fixture.js"], exclude: ["fixture.js"], sourceText: () => source });
    expect(summary.lines.total).toBe(0);
  });
});
