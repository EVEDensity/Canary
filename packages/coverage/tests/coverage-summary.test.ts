import { describe, expect, it } from "vitest";
import { assignFeatureCoverage, metric, mergeCoverageSummaries, summarizeCoverage } from "../src/index.js";
import { SourceMapGenerator } from "source-map-js/source-map.js";

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


describe("feature and multi-case aggregation", () => {
  it("unions covered identities without double counting and preserves case sets", () => {
    const file = { filePath: "/workspace/fixture.js", sourceHash: "h", status: "partial" as const, lines: { covered: 1, total: 2, pct: 50 }, statements: { covered: 1, total: 2, pct: 50 }, functions: { covered: 1, total: 2, pct: 50 }, branches: { covered: 1, total: 2, pct: 50 }, uncoveredLocations: [], coveredLineNumbers: [1], coveredStatementIds: ["s1"], coveredFunctionIds: ["f1"], coveredBranchIds: ["b1"] };
    const second = { ...file, coveredLineNumbers: [1, 2], coveredStatementIds: ["s1", "s2"], coveredFunctionIds: ["f1", "f2"], coveredBranchIds: ["b1", "b2"], lines: { covered: 2, total: 2, pct: 100 }, statements: { covered: 2, total: 2, pct: 100 }, functions: { covered: 2, total: 2, pct: 100 }, branches: { covered: 2, total: 2, pct: 100 } };
    const feature = { featureId: "planning", name: "Planning", status: "covered" as const, caseIds: ["case-2"], expectedCaseIds: ["case-2"], failedCaseIds: [], filePaths: ["/workspace/fixture.js"], coverage: { covered: 2, total: 2, pct: 100 }, uncoveredLocations: [] };
    const merged = mergeCoverageSummaries("run_multi", [
      { runId: "run_multi", sourceHash: "h", status: "final", lines: file.lines, statements: file.statements, functions: file.functions, branches: file.branches, files: [file], featureChains: [{ ...feature, status: "partial", caseIds: ["case-1"], expectedCaseIds: ["case-1"], coverage: { covered: 1, total: 2, pct: 50 } }] },
      { runId: "run_multi", sourceHash: "h", status: "final", lines: second.lines, statements: second.statements, functions: second.functions, branches: second.branches, files: [second], featureChains: [feature] },
    ], [{ id: "planning", name: "Planning", files: ["fixture.js"] }], "/workspace");
    expect(merged.lines).toEqual({ covered: 2, total: 2, pct: 100 });
    expect(merged.featureChains[0]).toMatchObject({ status: "covered", caseIds: ["case-1", "case-2"], expectedCaseIds: ["case-1", "case-2"] });
  });
});


describe("source-map coverage mapping", () => {
  it("maps generated V8 ranges back to shifted TypeScript locations", () => {
    const original = `export function run() {\n  return 1;\n}\n`;
    const generated = `const __wrapper = true;\nexport function run() {\n  return 1;\n}\n`;
    const map = new SourceMapGenerator({ file: "generated.js" });
    map.setSourceContent("source.ts", original);
    map.addMapping({ generated: { line: 2, column: 0 }, original: { line: 1, column: 0 }, source: "source.ts" });
    map.addMapping({ generated: { line: 2, column: 22 }, original: { line: 1, column: 22 }, source: "source.ts" });
    map.addMapping({ generated: { line: 3, column: 2 }, original: { line: 2, column: 2 }, source: "source.ts" });
    const start = generated.indexOf("export");
    const summary = summarizeCoverage("run_map", [{ url: "file:///workspace/generated.js", source: generated, sourceMap: JSON.stringify(map.toJSON()), functions: [{ functionName: "run", ranges: [{ startOffset: start, endOffset: generated.length, count: 1 }] }] }], { rootDir: "/workspace", include: ["source.ts"], sourceText: (filePath) => filePath.endsWith("source.ts") ? original : undefined });
    expect(summary.files?.[0]?.functions).toEqual({ covered: 1, total: 1, pct: 100 });
    expect(summary.files?.[0]?.quality).toMatchObject({ mappingMode: "source-map", precision: "approximate" });
    expect(summary.files?.[0]?.quality?.diagnostics).toContain("SOURCE_MAP_TOKEN_GRANULARITY");
  });
});

describe("feature status matrix", () => {
  const feature = { id: "planning", name: "Planning", files: ["fixture.js"] };
  const base = summarizeCoverage("run_feature", [script], { rootDir: "/workspace", include: ["fixture.js"], sourceText: () => source, features: [feature] });
  it.each([
    ["covered", [{ featureId: "planning", status: "entered" as const }, { featureId: "planning", status: "completed" as const }], 1, "partial"],
    ["partial", [{ featureId: "planning", status: "entered" as const }], 1, "partial"],
    ["uncovered", [], 0, "uncovered"],
    ["failed", [{ featureId: "planning", status: "failed" as const }], 1, "failed"],
  ])("classifies %s feature execution", (_label, events, expected, status) => {
    const result = assignFeatureCoverage(base, [feature], events, ["planning"], "case-1", "/workspace");
    expect(result.featureChains[0]).toMatchObject({ status, expectedCaseIds: ["case-1"], caseIds: expected ? ["case-1"] : [] });
  });
  it("classifies a feature without selected files as unavailable", () => {
    const result = assignFeatureCoverage(base, [{ id: "missing", files: ["missing.ts"] }], [], [], undefined, "/workspace");
    expect(result.featureChains[0]?.status).toBe("unavailable");
  });
});
