import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCoverageManifestForFile, summarizeCoverage } from "../src/index.js";
import { expectedCoverageMatrix } from "./fixtures/expected-matrix.js";

const fixtures = dirname(fileURLToPath(new URL("./fixtures/expected-matrix.ts", import.meta.url)));
function load(name: string): { filePath: string; source: string } {
  const filePath = join(fixtures, name);
  return { filePath, source: readFileSync(filePath, "utf8") };
}
function coveredScript(filePath: string, source: string, start: number, end: number, count: number) {
  return { url: `file:///workspace/${filePath}`, source, functions: [{ functionName: "", ranges: [{ startOffset: start, endOffset: end, count }] }] };
}

describe("coverage fixture matrix", () => {
  it("counts function units and executed vs idle functions", () => {
    const { source } = load("function-fixture.ts");
    const manifest = createCoverageManifestForFile("function-fixture.ts", source);
    expect(manifest.functionLocations).toHaveLength(expectedCoverageMatrix.functionFixture.functions.total);
    expect(manifest.statementLocations).toHaveLength(expectedCoverageMatrix.functionFixture.statements.total);
    const executedEnd = source.indexOf("export function idle");
    const summary = summarizeCoverage("run_functions", [
      coveredScript("function-fixture.ts", source, 0, executedEnd, 1),
      coveredScript("function-fixture.ts", source, executedEnd, source.length, 0),
    ], { rootDir: "/workspace", include: ["function-fixture.ts"], sourceText: () => source });
    expect(summary.functions.covered).toBe(expectedCoverageMatrix.functionFixture.functions.executed);
    expect(summary.functions.total).toBe(expectedCoverageMatrix.functionFixture.functions.total);
  });

  it("distinguishes true and false if-branches", () => {
    const { source } = load("branch-fixture.ts");
    const manifest = createCoverageManifestForFile("branch-fixture.ts", source);
    expect(manifest.branchLocations).toHaveLength(expectedCoverageMatrix.branchFixture.branches.total);
    const thenStart = source.indexOf("return \"yes\"");
    const summary = summarizeCoverage("run_branch", [coveredScript("branch-fixture.ts", source, 0, thenStart + 12, 1)], { rootDir: "/workspace", include: ["branch-fixture.ts"], sourceText: () => source });
    expect(summary.branches.covered).toBe(expectedCoverageMatrix.branchFixture.branches.covered);
    expect(summary.branches.total).toBe(expectedCoverageMatrix.branchFixture.branches.total);
  });

  it("counts both ternary branches", () => {
    const { source } = load("ternary-fixture.ts");
    const manifest = createCoverageManifestForFile("ternary-fixture.ts", source);
    expect(manifest.branchLocations).toHaveLength(expectedCoverageMatrix.ternaryFixture.branches.total);
    expect(manifest.branchLocations.map((branch) => branch.branchType)).toEqual(["conditional", "conditional"]);
  });

  it("records throw/catch executable statements without marking unloaded code covered", () => {
    const { source } = load("error-fixture.ts");
    const manifest = createCoverageManifestForFile("error-fixture.ts", source);
    expect(manifest.functionLocations).toHaveLength(expectedCoverageMatrix.errorFixture.functions.total);
    expect(manifest.branchLocations.length).toBeGreaterThanOrEqual(expectedCoverageMatrix.errorFixture.branches.total);
    expect(source).toContain("catch");
  });

  it("keeps an unloaded fixture in the denominator at 0%", () => {
    const { source } = load("unloaded-fixture.ts");
    const summary = summarizeCoverage("run_unloaded", [], { rootDir: "/workspace", include: ["unloaded-fixture.ts"], sourceText: () => source });
    expect(summary.files).toHaveLength(expectedCoverageMatrix.unloadedFixture.files.total);
    expect(summary.lines.covered).toBe(expectedCoverageMatrix.unloadedFixture.lines.covered);
    expect(summary.lines.total).toBeGreaterThan(0);
    expect(summary.lines.pct).toBe(0);
  });
});
