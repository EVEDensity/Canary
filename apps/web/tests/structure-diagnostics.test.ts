import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { CoverageManifest, CoverageSummary } from "@canary/core";
import { buildStructure } from "@canary/structure";
import { checkLogs, mapCoverageToStructure, mapFailuresToStructure } from "../src/structure-diagnostics.js";
import { readStructureSource } from "../src/structure-source.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "canary-r12-"));
  const source = "export function choose(flag: boolean) {\n  if (flag) return 1;\n  return 0;\n}\n";
  const filePath = join(root, "index.ts");
  writeFileSync(filePath, source);
  const structure = buildStructure(root);
  const file = structure.nodes.find((node) => node.kind === "file" && node.path === "index.ts")!;
  const symbol = structure.nodes.find((node) => node.kind === "function" && node.name === "choose")!;
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
  const branch = (id: string, branchIndex: number) => ({ id, kind: "branch" as const, filePath, start: { line: 2, column: 3 }, end: { line: 2, column: 22 }, branchType: "if" as const, branchIndex });
  const manifest: CoverageManifest = {
    sourceHash: hash, rootDir: root, include: [], exclude: [], features: [],
    files: [{ filePath, sourceHash: hash, executableLines: [2, 3], statementLocations: [], functionLocations: [{ id: "fn", kind: "function", filePath, start: { line: 1, column: 1 }, end: { line: 4, column: 2 } }], branchLocations: [branch("b0", 0), branch("b1", 1)], quality: { mappingMode: "ast", precision: "exact", diagnostics: [] } }],
  };
  const coverage: CoverageSummary = {
    runId: "run_coverage", sourceHash: hash, status: "partial", lines: { covered: 1, total: 2, pct: 50 }, statements: { covered: 0, total: 0, pct: 0 }, functions: { covered: 1, total: 1, pct: 100 }, branches: { covered: 1, total: 2, pct: 50 }, featureChains: [],
    files: [{ filePath, sourceHash: hash, status: "partial", quality: { mappingMode: "ast", precision: "exact", diagnostics: [] }, lines: { covered: 1, total: 2, pct: 50 }, statements: { covered: 0, total: 0, pct: 0 }, functions: { covered: 1, total: 1, pct: 100 }, branches: { covered: 1, total: 2, pct: 50 }, executableLineNumbers: [2, 3], coveredLineNumbers: [2], coveredFunctionIds: ["fn"], coveredBranchIds: ["b0"], uncoveredLocations: [branch("b1", 1)] }],
  };
  return { root, filePath, structure, file, symbol, manifest, coverage };
}

describe("R12 structure diagnostics", () => {
  it("maps file and function denominators from sealed coverage and retains the missing branch", () => {
    const value = fixture();
    const mapped = mapCoverageToStructure(value.structure, [{ runId: "run_coverage", coverage: value.coverage, manifest: value.manifest }]);
    const file = mapped.find((item) => item.nodeId === value.file.id)!;
    const symbol = mapped.find((item) => item.nodeId === value.symbol.id)!;
    expect([file.lines, file.functions, file.branches]).toEqual([value.coverage.files![0]!.lines, value.coverage.files![0]!.functions, value.coverage.files![0]!.branches]);
    expect(symbol.lines).toEqual({ covered: 1, total: 2, pct: 50 });
    expect(symbol.functions).toEqual({ covered: 1, total: 1, pct: 100 });
    expect(symbol.branches).toEqual({ covered: 1, total: 2, pct: 50 });
    expect(symbol.uncoveredBranches.map((item) => item.id)).toEqual(["b1"]);
    expect(readStructureSource(value.structure, value.file.id, 2)?.startLine).toBe(1);
  });

  it("marks unavailable or mismatched measurements unknown instead of calling them uncovered", () => {
    const value = fixture();
    const unavailable = structuredClone(value.coverage);
    unavailable.files![0]!.status = "unavailable";
    const unknown = mapCoverageToStructure(value.structure, [{ runId: "run_coverage", coverage: unavailable, manifest: value.manifest }]);
    expect(unknown).toHaveLength(1);
    expect(unknown[0]).toMatchObject({ precision: "unknown", uncoveredBranches: [] });
    expect(unknown[0]).not.toHaveProperty("lines");
    const mismatch = structuredClone(value.coverage);
    mismatch.files![0]!.sourceHash = "0".repeat(16);
    expect(mapCoverageToStructure(value.structure, [{ runId: "run_coverage", coverage: mismatch, manifest: value.manifest }])[0]).toMatchObject({ status: "source-mismatch", precision: "unknown" });
    const foreign = structuredClone(value.coverage);
    foreign.files![0]!.filePath = join(tmpdir(), "elsewhere.ts");
    expect(mapCoverageToStructure(value.structure, [{ runId: "run_coverage", coverage: foreign, manifest: value.manifest }])).toEqual([]);
  });

  it("links a real stack frame to a symbol while retaining current, historical and verified states", () => {
    const value = fixture();
    const issue = { id: "issue", runId: "run_failed", checkId: "unit", category: "assertion", title: "unit", summary: "AssertionError", advice: "", target: "check" as const, status: "open" as const };
    const log = checkLogs([{ id: "unit", outputEvidence: { stderr: [`AssertionError: expected 2`, `    at choose (${value.filePath}:2:7)`], stdout: [] } }]);
    const current = mapFailuresToStructure(value.structure, [issue], log)[0]!;
    expect(current).toMatchObject({ state: "current", nodeId: value.symbol.id, fileNodeId: value.file.id, line: 2, column: 7, confidence: "path-line" });
    expect(current.summary).toContain("AssertionError: expected 2");
    const fileUrl = checkLogs([{ id: "unit", stderr: `    at choose (${pathToFileURL(value.filePath).href}:2:7)` }]);
    expect(mapFailuresToStructure(value.structure, [issue], fileUrl)[0]).toMatchObject({ nodeId: value.symbol.id, line: 2, confidence: "path-line" });
    expect(mapFailuresToStructure(value.structure, [issue], log, true)[0]?.state).toBe("historical");
    expect(mapFailuresToStructure(value.structure, [{ ...issue, status: "verified", verification: { runId: "run_fixed", reason: "passed" } }], log)[0]).toMatchObject({ state: "verified", verificationRunId: "run_fixed" });
    const outside = checkLogs([{ id: "unit", stderr: `at external (${join(tmpdir(), "external.ts")}:2:1)` }]);
    expect(mapFailuresToStructure(value.structure, [issue], outside)[0]).toMatchObject({ confidence: "unknown" });
    expect(mapFailuresToStructure(value.structure, [issue], outside)[0]).not.toHaveProperty("nodeId");
  });
});
