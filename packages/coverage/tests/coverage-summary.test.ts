import { describe, expect, it } from "vitest";
import { summarizeCoverage } from "../src/index.js";

describe("coverage summary", () => {
  const source = `function one(value) {\n  if (value) return true;\n  return false;\n}\nfunction two() { throw new Error('x'); }\n`;
  const script = {
    url: "file:///workspace/fixture.js",
    functions: [
      { functionName: "one", ranges: [{ startOffset: 0, endOffset: 80, count: 1 }, { startOffset: 28, endOffset: 48, count: 1 }] },
      { functionName: "two", ranges: [{ startOffset: 81, endOffset: source.length, count: 0 }] }
    ]
  };

  it("counts branch, function and line coverage", () => {
    const summary = summarizeCoverage("run_fixture", [script], {
      rootDir: "/workspace",
      include: ["fixture.js"],
      sourceText: () => source
    });
    expect(summary.functions.total).toBe(2);
    expect(summary.functions.covered).toBe(1);
    expect(summary.branches.total).toBeGreaterThan(0);
    expect(summary.lines.total).toBeGreaterThan(0);
  });

  it("keeps an explicitly included but not loaded file in the denominator", () => {
    const summary = summarizeCoverage("run_empty", [], {
      rootDir: "/workspace",
      include: ["fixture.js"],
      sourceText: () => source
    });
    expect(summary.status).toBe("final");
    expect(summary.lines.total).toBe(0);
  });

  it("filters excluded files", () => {
    const summary = summarizeCoverage("run_excluded", [script], {
      rootDir: "/workspace",
      include: ["fixture.js"],
      exclude: ["fixture.js"],
      sourceText: () => source
    });
    expect(summary.lines.total).toBe(0);
  });
});
