import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { CoverageManifest, CoverageManifestLocation, CoverageSummary } from "@canary/core";
import { createCoverageManifestForFile, summarizeCoverage } from "@canary/coverage";
import { beginArtifacts, FileArtifactRepository, sealArtifacts, writePrivateJson } from "@canary/trace";
import { analyzeChangedFile } from "../src/changed-file.js";

const source =
  "export function first(x) {\n  return x ? 1 : 0;\n}\nexport function second(x) {\n  return x ? 2 : 0;\n}\n";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const exact = { mappingMode: "ast" as const, precision: "exact" as const, diagnostics: [] };
const metric = { total: 2, covered: 1, pct: 50 };
const location = (id: string, kind: "function" | "branch", start: number, end = start): CoverageManifestLocation => ({
  id,
  kind,
  filePath: "module.mjs",
  start: { line: start, column: 1 },
  end: { line: end, column: 2 },
});
function fixture(text = source) {
  const hash = digest(text);
  const coverage: CoverageSummary = {
    runId: "run_coverage",
    sourceHash: hash,
    status: "final",
    lines: metric,
    statements: metric,
    functions: metric,
    branches: metric,
    featureChains: [],
    files: [
      {
        filePath: "module.mjs",
        sourceHash: hash,
        sourceText: text,
        status: "partial",
        quality: exact,
        lines: metric,
        statements: metric,
        functions: metric,
        branches: metric,
        uncoveredLocations: [],
        executableLineNumbers: [2, 5],
        coveredLineNumbers: [2],
        coveredFunctionIds: ["f1"],
        coveredBranchIds: ["yes1", "yes2"],
      },
    ],
  };
  const manifest: CoverageManifest = {
    sourceHash: hash,
    rootDir: ".",
    include: [],
    exclude: [],
    features: [],
    files: [
      {
        filePath: "module.mjs",
        sourceHash: hash,
        sourceText: text,
        executableLines: [2, 5],
        statementLocations: [],
        functionLocations: [location("f1", "function", 1, 3), location("f2", "function", 4, 6)],
        branchLocations: [
          location("yes1", "branch", 2),
          location("no1", "branch", 2),
          location("yes2", "branch", 5),
          location("no2", "branch", 5),
        ],
        quality: exact,
      },
    ],
  };
  return { coverage, manifest };
}
const analyze = (coverageSources: ReturnType<typeof fixture>[], changedLines = [2, 5], text = source) =>
  analyzeChangedFile({ path: "module.mjs", root: ".", source: text, changedLines, coverageSources });

describe("historical changed-file execution evidence", () => {
  it("uses the full historical hash to recover only the exact persisted source-text display truncation", () => {
    const root = mkdtempSync(join(tmpdir(), "canary-long-coverage-"));
    try {
      const historical = source + "// ordinary source marker\n".repeat(200),
        value = fixture(historical);
      const artifactRoot = join(root, "artifacts"),
        dir = join(artifactRoot, "run_long_source");
      beginArtifacts(dir);
      writePrivateJson(join(dir, "run.json"), {
        runId: "run_long_source",
        status: "completed",
        startedAt: "2026-10-16T00:00:00.000Z",
        totalCases: 0,
        completedCases: 0,
        passedCases: 0,
        results: [],
        events: [],
        coverage: value.coverage,
      });
      writePrivateJson(join(dir, "coverage-manifest.json"), value.manifest);
      sealArtifacts(dir);
      const persisted = JSON.parse(readFileSync(join(dir, "run.json"), "utf8"));
      expect(persisted.coverage.files[0].sourceText).toBe(historical.slice(0, 2048) + "…");
      const repository = new FileArtifactRepository(artifactRoot),
        coverage = repository.readRun("run_long_source")!.coverage!,
        manifest = repository.readJson<CoverageManifest>("run_long_source", "coverage-manifest.json")!;
      expect(coverage.files![0]!.sourceText).toHaveLength(2049);
      expect(manifest.files[0]!.sourceText).toBe(historical.slice(0, 2048) + "…");
      expect(analyze([{ coverage, manifest }], [2, 5], historical).execution.status).toBe("measured");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts exact long-source display truncation with the persisted 16-hex hash", () => {
    const historical = source + "// full historical source\n".repeat(150),
      value = fixture(historical);
    for (const file of [value.coverage.files![0]!, value.manifest.files[0]!]) {
      file.sourceHash = digest(historical).slice(0, 16);
      file.sourceText = historical.slice(0, 2048) + "…";
    }
    const result = analyze([value], [2, 5], historical);
    expect(result.execution).toMatchObject({
      status: "measured",
      lines: { total: 2, covered: 1 },
      functions: { total: 2, covered: 1 },
      branches: { total: 4, covered: 2 },
    });
    expect(result.uncovered).toEqual({ lines: [5], functions: ["f2"], branches: ["no1", "no2"] });
  });

  it.each(["wrong-prefix", "wrong-hash", "wrong-length", "wrong-marker", "redacted-prefix"])(
    "does not ignore a %s source-text mismatch",
    (scenario) => {
      const historical = source + "// full historical source\n".repeat(150),
        value = fixture(historical),
        file = value.coverage.files![0]!;
      file.sourceText = historical.slice(0, 2048) + "…";
      if (scenario === "wrong-prefix") file.sourceText = "!" + file.sourceText.slice(1);
      if (scenario === "wrong-hash") file.sourceHash = digest(historical + "changed");
      if (scenario === "wrong-length") file.sourceText = historical.slice(0, 2000) + "…";
      if (scenario === "wrong-marker") file.sourceText = historical.slice(0, 2048) + "...";
      if (scenario === "redacted-prefix") file.sourceText = "[redacted]" + file.sourceText.slice(10);
      expect(analyze([value], [2, 5], historical).execution.status).toBe("unknown");
    },
  );

  it("does not ignore a mismatched manifest excerpt even when line evidence is available", () => {
    const historical = source + "// full historical source\n".repeat(150),
      value = fixture(historical);
    value.coverage.files![0]!.sourceText = historical.slice(0, 2048) + "…";
    value.manifest.files[0]!.sourceText = "!" + historical.slice(1, 2048) + "…";
    const result = analyze([value], [2, 5], historical);
    expect(result.execution.lines).toEqual({ total: 2, covered: 1 });
    expect(result.execution.functions).toEqual({ total: null, covered: null });
    expect(result.execution.branches).toEqual({ total: null, covered: null });
  });

  it("unions complementary observations without adding duplicate denominators", () => {
    const first = fixture(),
      second = fixture();
    second.coverage.files![0]!.coveredLineNumbers = [5];
    second.coverage.files![0]!.coveredFunctionIds = ["f2"];
    second.coverage.files![0]!.coveredBranchIds = ["no1", "no2"];
    const result = analyze([first, second, first]);
    expect(result.execution).toMatchObject({
      status: "measured",
      lines: { total: 2, covered: 2 },
      functions: { total: 2, covered: 2 },
      branches: { total: 4, covered: 4 },
    });
    expect(result.uncovered).toEqual({ lines: [], functions: [], branches: [] });
  });

  it("retains exact missing paths and limits all denominators to changed ranges", () => {
    const result = analyze([fixture()], [5]);
    expect(result.execution).toMatchObject({
      lines: { total: 1, covered: 0 },
      functions: { total: 1, covered: 0 },
      branches: { total: 2, covered: 1 },
    });
    expect(result.uncovered).toEqual({ lines: [5], functions: ["f2"], branches: ["no2"] });
    expect(result.interpretation).toContain("does not establish behavior");
  });

  it("preserves line evidence but marks conflicting branch identities unknown", () => {
    const first = fixture(),
      second = fixture();
    second.manifest.files[0]!.branchLocations[0]!.end.column = 3;
    const result = analyze([first, second]);
    expect(result.execution.lines).toEqual({ total: 2, covered: 1 });
    expect(result.execution.functions).toEqual({ total: 2, covered: 1 });
    expect(result.execution.branches).toEqual({ total: null, covered: null });
    expect(result.execution.reasons.join(" ")).toMatch(/branches:.*conflict/);
    expect(result.uncovered.branches).toEqual([]);
  });

  it("rejects inconsistent executable denominators instead of choosing the highest percentage", () => {
    const first = fixture(),
      second = fixture();
    second.coverage.files![0]!.executableLineNumbers = [2];
    second.manifest.files[0]!.executableLines = [2];
    const result = analyze([first, second]);
    expect(result.execution.lines).toEqual({ total: null, covered: null });
    expect(result.execution.reasons.join(" ")).toMatch(/lines:.*conflict/);
  });

  it("rejects a collection mismatch while keeping independently bound line observations", () => {
    const first = fixture();
    first.manifest.sourceHash = "different-collection";
    const result = analyze([first]);
    expect(result.execution.lines).toEqual({ total: 2, covered: 1 });
    expect(result.execution.functions).toEqual({ total: null, covered: null });
    expect(result.execution.branches).toEqual({ total: null, covered: null });
    expect(result.execution.reasons.join(" ")).toContain("collection identities conflict");
  });

  it.each(["partial", "unavailable"] as const)("does not treat %s collection as final", (status) => {
    const first = fixture();
    first.coverage.status = status;
    const result = analyze([first]);
    expect(result.execution.status).toBe("unknown");
    expect(result.execution.lines).toEqual({ total: null, covered: null });
  });

  it("excludes unknown or approximate mapping without discarding a reliable observation", () => {
    const good = fixture(),
      bad = fixture();
    bad.coverage.files![0]!.quality = { ...exact, precision: "approximate" };
    bad.coverage.files![0]!.coveredLineNumbers = [2, 5];
    expect(analyze([bad]).execution.status).toBe("unknown");
    expect(analyze([good, bad]).execution.lines).toEqual({ total: 2, covered: 1 });
  });

  it("accepts only full SHA-256 or the persisted 16-hex source hash", () => {
    const first = fixture();
    first.coverage.files![0]!.sourceHash = digest(source).slice(0, 16);
    first.manifest.files[0]!.sourceHash = digest(source).slice(0, 16);
    expect(analyze([first]).execution.status).toBe("measured");
    first.coverage.files![0]!.sourceHash = digest(source).slice(0, 15);
    expect(analyze([first]).execution.status).toBe("unknown");
    first.coverage.files![0]!.sourceHash = digest(source + " ");
    expect(analyze([first]).execution.status).toBe("unknown");
  });

  it("binds even empty recorded source text instead of falling through on falsy values", () => {
    const empty = fixture("");
    expect(analyze([empty]).execution.status).toBe("unknown");
    const result = analyzeChangedFile({
      path: "empty.mjs",
      root: ".",
      source: "",
      changedLines: [],
      coverage: {
        ...empty.coverage,
        files: [
          { ...empty.coverage.files![0]!, filePath: "empty.mjs", executableLineNumbers: [], coveredLineNumbers: [] },
        ],
      },
    });
    expect(result.execution.lines).toEqual({ total: 0, covered: 0 });
    expect(result.execution.functions).toEqual({ total: null, covered: null });
    expect(result.execution).not.toHaveProperty("pct");
  });

  it("compares CRLF and Git-normalized LF by recorded text while checking the exact recorded hash", () => {
    const first = fixture(source.replaceAll("\n", "\r\n"));
    expect(analyze([first]).execution.lines).toEqual({ total: 2, covered: 1 });
    first.coverage.files![0]!.sourceHash = digest(source);
    expect(analyze([first]).execution.status).toBe("unknown");
  });

  it("does not invent zero or 100% when execution arrays are missing", () => {
    const first = fixture();
    delete first.coverage.files![0]!.executableLineNumbers;
    delete first.coverage.files![0]!.coveredFunctionIds;
    delete first.coverage.files![0]!.coveredBranchIds;
    first.coverage.files![0]!.lines = { total: 0, covered: 0, pct: 100 };
    const result = analyze([first]);
    expect(result.execution.status).toBe("unknown");
    for (const dimension of ["lines", "functions", "branches"] as const)
      expect(result.execution[dimension]).toEqual({ total: null, covered: null });
    expect(result.uncovered).toEqual({ lines: [], functions: [], branches: [] });
  });

  it("rejects line hits outside executable identities", () => {
    const first = fixture();
    first.coverage.files![0]!.coveredLineNumbers = [1, 2];
    expect(analyze([first]).execution.lines).toEqual({ total: null, covered: null });
  });

  it.each(["functions", "branches"] as const)("rejects %s hits outside the manifest and duplicate IDs", (dimension) => {
    const first = fixture();
    const key = dimension === "functions" ? "coveredFunctionIds" : "coveredBranchIds";
    first.coverage.files![0]![key] = ["invented"];
    expect(analyze([first]).execution[dimension]).toEqual({ total: null, covered: null });
    first.coverage.files![0]![key] = dimension === "functions" ? ["f1", "f1"] : ["yes1", "yes1"];
    expect(analyze([first]).execution[dimension]).toEqual({ total: null, covered: null });
  });

  it("rejects manifest positions with offsets unrelated to the bound historical text", () => {
    const first = fixture();
    first.manifest.files[0]!.functionLocations[0]!.start.offset = 99;
    expect(analyze([first]).execution.functions).toEqual({ total: null, covered: null });
    expect(analyze([first]).execution.lines).toEqual({ total: 2, covered: 1 });
  });

  it("rejects an execution anchor outside its source range", () => {
    const first = fixture();
    first.manifest.files[0]!.functionLocations[0]!.executionStart = { line: 5, column: 1 };
    expect(analyze([first]).execution.functions).toEqual({ total: null, covered: null });
    expect(analyze([first]).execution.branches).toEqual({ total: 4, covered: 2 });
  });

  it("reports a known empty range as zero with no synthesized percentage", () => {
    const result = analyze([fixture()], [7]);
    expect(result.execution.status).toBe("measured");
    for (const dimension of ["lines", "functions", "branches"] as const)
      expect(result.execution[dimension]).toEqual({ total: 0, covered: 0 });
    expect(result.uncovered).toEqual({ lines: [], functions: [], branches: [] });
  });

  it("filters paths outside the project and accepts historical Windows separators", () => {
    const first = fixture();
    first.coverage.files![0]!.filePath = "../module.mjs";
    expect(analyze([first]).execution.status).toBe("unknown");
    first.coverage.files![0]!.filePath = "D:\\project\\module.mjs";
    first.manifest.files[0]!.filePath = "D:\\project\\module.mjs";
    for (const item of [...first.manifest.files[0]!.functionLocations, ...first.manifest.files[0]!.branchLocations])
      item.filePath = "D:\\project\\module.mjs";
    expect(
      analyzeChangedFile({ path: "module.mjs", root: "D:\\project", source, changedLines: [2], ...first }).execution
        .status,
    ).toBe("measured");
    first.coverage.files![0]!.filePath = "D:\\other\\module.mjs";
    expect(
      analyzeChangedFile({ path: "module.mjs", root: "D:\\project", source, changedLines: [2], ...first }).execution
        .status,
    ).toBe("unknown");
  });

  it("keeps real final-collection partial-file branch coverage measurable", () => {
    const text = 'export function choose(x) { return x ? "yes" : "no"; }\n';
    const file = createCoverageManifestForFile(resolve("module.mjs"), text);
    const branch = file.branchLocations[1]!;
    const summary = summarizeCoverage(
      "run_partial_file",
      [
        {
          url: file.filePath,
          source: text,
          functions: [
            {
              functionName: "choose",
              ranges: [
                { startOffset: 0, endOffset: text.length, count: 1 },
                { startOffset: branch.start.offset!, endOffset: branch.end.offset!, count: 0 },
              ],
            },
          ],
        },
      ],
      { rootDir: process.cwd(), include: ["module.mjs"], sourceText: () => text },
    );
    expect(summary.status).toBe("final");
    expect(summary.files![0]!.status).toBe("partial");
    expect(summary.files![0]!.quality!.precision).toBe("exact");
    const manifest: CoverageManifest = {
      sourceHash: summary.sourceHash,
      rootDir: process.cwd(),
      include: [],
      exclude: [],
      features: [],
      files: [file],
    };
    const result = analyzeChangedFile({
      path: "module.mjs",
      root: process.cwd(),
      source: text,
      changedLines: [1],
      coverage: summary,
      manifest,
    });
    expect(result.execution.branches).toEqual({ total: 2, covered: 1 });
    expect(result.uncovered.branches).toEqual([branch.id]);
  });
});
