import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SourceMapGenerator } from "source-map-js";
import { pathToFileURL } from "node:url";
import type { CoverageFragment, CoverageManifestFile } from "@canary/core";
import { ISTANBUL_GLOBAL, dedupeCoverageFragments, instrumentIstanbul, mergeV8Scripts, readIstanbulCoverage, summarizeIstanbulCoverage } from "../src/index.js";
import { createProbe, prepareScript, SOURCE_MAP_PRECISION } from "../src/source-mapping.js";

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[ISTANBUL_GLOBAL];
});

describe("istanbul instrumentation", () => {
  it("records exact AST coverage including the taken then-branch", () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-istanbul-"));
    const filePath = join(cwd, "one.js");
    const source = "function one(value) { if (value) return true; else return false; }\n";
    writeFileSync(filePath, source, "utf8");
    const { code } = instrumentIstanbul(source, filePath);
    const one = new Function(`${code}\nreturn one;`)() as (value: boolean) => boolean;
    expect(one(true)).toBe(true);
    const summary = summarizeIstanbulCoverage("run_istanbul", readIstanbulCoverage(), { rootDir: cwd, include: ["one.js"] });
    expect(summary.files?.[0]?.quality?.precision).toBe("exact");
    expect(summary.files?.[0]?.quality?.mappingMode).toBe("ast");
    expect(summary.branches.covered).toBeGreaterThan(0);
    expect(summary.branches.covered).toBeLessThan(summary.branches.total);
  });
});

describe("coverage fragments", () => {
  it("drops duplicate fragment identities and unions range counts by max", () => {
    const script = (count: number) => ({
      url: "file:///a.js",
      functions: [{ functionName: "f", ranges: [{ startOffset: 0, endOffset: 10, count }] }],
    });
    const fragment = (sequence: number, count: number): CoverageFragment => ({
      runId: "r",
      executionId: "e",
      provider: "node-v8",
      processId: 1,
      isolateId: "iso",
      sequence,
      sourceHash: "h",
      capturedAt: "t",
      status: "final",
      scripts: [script(count)],
    });
    expect(dedupeCoverageFragments([fragment(1, 1), fragment(1, 9), fragment(2, 3)])).toHaveLength(2);
    const merged = mergeV8Scripts([[script(1)], [script(4)]]);
    expect(merged[0]?.functions[0]?.ranges[0]?.count).toBe(4);
  });
});

describe("source-map precision", () => {
  it("stays approximate when generated source differs from the original file", () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-map-"));
    const originalPath = join(cwd, "one.ts");
    const original = "function one(value) {\n  if (value) return true;\n  return false;\n}\n";
    writeFileSync(originalPath, original, "utf8");
    const generated = "function one(value){if(value)return true;return false;}\n";
    const map = new SourceMapGenerator({ file: "one.js" });
    map.setSourceContent("one.ts", original);
    for (let line = 1; line <= 4; line += 1) {
      map.addMapping({ generated: { line: 1, column: 0 }, original: { line, column: 0 }, source: "one.ts" });
    }
    const manifest: CoverageManifestFile = {
      filePath: originalPath,
      sourceHash: createHash("sha256").update(original).digest("hex").slice(0, 16),
      sourceText: original,
      executableLines: [1, 2, 3],
      statementLocations: [],
      functionLocations: [],
      branchLocations: [],
      quality: { mappingMode: "source-map", precision: "approximate", diagnostics: [] },
    };
    const script = {
      url: pathToFileURL(join(cwd, "one.js")).href,
      source: `${generated}//# sourceMappingURL=data:application/json;base64,${Buffer.from(map.toString()).toString("base64")}`,
      functions: [{ functionName: "one", ranges: [{ startOffset: 0, endOffset: generated.length, count: 1 }] }],
    };
    const probe = createProbe(manifest, prepareScript(script, cwd));
    expect(probe.available).toBe(true);
    expect(probe.quality.mappingMode).toBe("source-map");
    expect(probe.quality.precision).toBe(SOURCE_MAP_PRECISION);
  });
});
