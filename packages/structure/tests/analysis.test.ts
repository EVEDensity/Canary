import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildStructure, compareStructure, analyzeArchitecture, analyzeImpact, planAffectedChecks, matchImpactPath, type StructureSnapshot } from "../src/index.js";

const roots: string[] = [];
const git = (root: string, ...args: string[]) => execFileSync("git", args, { cwd: root, windowsHide: true, stdio: "ignore" });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "canary-analysis-")); roots.push(root); mkdirSync(join(root, "src"));
  writeFileSync(join(root, "package.json"), '{"type":"module"}');
  writeFileSync(join(root, "src/math.ts"), "export function answer() { return 1; }\n");
  writeFileSync(join(root, "src/app.ts"), "import { answer } from './math.js';\nexport const result = answer();\n");
  writeFileSync(join(root, "src/other.ts"), "export const unrelated = 1;\n");
  git(root, "init", "-q"); git(root, "add", "."); git(root, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "baseline");
  return root;
}
const checks = [
  { id: "prep", required: true, dependsOn: [], impact: { paths: ["src/other.ts"] } },
  { id: "app", required: true, dependsOn: ["prep"], impact: { paths: ["src/app.ts"] } },
  { id: "other", required: true, dependsOn: [], impact: { paths: ["src/other.ts"] } },
  { id: "safety", required: true, dependsOn: [] },
];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("R13 architecture evidence", () => {
  it("reports resolved cycles and explicit forbidden layers, excluding inferred edges", () => {
    const root = fixture();
    writeFileSync(join(root, "src/math.ts"), "import { result } from './app.js';\nexport function answer() { return result; }\n");
    writeFileSync(join(root, "canary.architecture.json"), JSON.stringify({ v: 1, layers: [{ id: "ui", name: "UI", paths: ["src/app.ts"] }, { id: "logic", name: "Logic", paths: ["src/math.ts"] }], rules: { forbiddenDependencies: [{ from: "logic", to: "ui", reason: "Logic must not import UI" }] } }));
    const snapshot = buildStructure(root), analysis = analyzeArchitecture(snapshot);
    expect(analysis.findings).toContainEqual(expect.objectContaining({ code: "dependency-cycle", paths: ["src/app.ts", "src/math.ts"], severity: "warning" }));
    expect(analysis.findings).toContainEqual(expect.objectContaining({ code: "forbidden-layer-dependency", reason: "Logic must not import UI", severity: "error" }));
    const one = snapshot.edges.find((edge) => edge.kind === "imports" && snapshot.nodes.find((node) => node.id === edge.from)?.path === "src/math.ts")!;
    one.provenance = "inferred"; one.certainty = "inferred";
    expect(analyzeArchitecture(snapshot).findings).toEqual([]);
  });
  it("handles a deep dependency graph without recursion overflow", () => {
    const snapshot = buildStructure(fixture());
    snapshot.nodes = Array.from({ length: 6000 }, (_, i) => ({ id: String(i), name: String(i), kind: "file", path: `${i}.ts` }));
    snapshot.edges = snapshot.nodes.map((node, i) => ({ id: `edge-${i}`, from: node.id, to: String((i + 1) % 6000), kind: "imports", provenance: "static", certainty: "resolved" }));
    expect(analyzeArchitecture(snapshot).findings[0]?.nodeIds).toHaveLength(6000);
  });
});
describe("R14/R15 impact and conservative selection", () => {
  it("selects consumers and fresh check prerequisites, retaining unscoped checks", () => {
    const root = fixture(); writeFileSync(join(root, "src/math.ts"), "export function answer() { return 2; }\n");
    const snapshot = buildStructure(root), impact = analyzeImpact(snapshot, compareStructure(root, snapshot, "HEAD"));
    expect(impact.confidence).toBe("static-potential");
    const app = impact.affected.find((node) => node.path === "src/app.ts")!;
    expect(app.reason).toBe("consumer"); expect(app.via?.edgeId).toMatch(/^imports:/);
    expect(impact.affected.some((node) => node.path === "src/other.ts")).toBe(false);
    const plan = planAffectedChecks(snapshot, impact, checks);
    expect(plan.mode).toBe("reduced");
    expect(plan.checks.map((check) => [check.id, check.action, check.reason])).toEqual([["prep", "run", "required-check-dependency"], ["app", "run", "affected-input"], ["other", "omit", "declared-scope-unaffected"], ["safety", "run", "always-or-unscoped"]]);
    expect(planAffectedChecks(snapshot, impact, checks, false).omittedCount).toBe(0);
    const changedPrerequisite = planAffectedChecks(snapshot, impact, [
      { ...checks[0]!, impact: { paths: ["src/math.ts"] } },
      { ...checks[1]!, impact: { paths: ["src/other.ts"] } },
      { ...checks[2]!, type: "http" },
    ]);
    expect(changedPrerequisite.checks[1]?.reason).toBe("affected-check-dependency");
    expect(changedPrerequisite.checks[2]?.reason).toBe("runtime-or-environment-check");
    expect(() => analyzeImpact({ ...snapshot, source: { ...snapshot.source, inventoryHash: "other" } }, compareStructure(root, snapshot, "HEAD"))).toThrow(/same captured source/);
  });
  it("resolves TypeScript aliases and literal require, while dynamic modules trigger full checks", () => {
    const root = fixture();
    writeFileSync(join(root, "tsconfig.json"), '{"compilerOptions":{"baseUrl":".","paths":{"@local/*":["src/*"]}}}');
    writeFileSync(join(root, "src/app.ts"), "import { answer } from '@local/math';\nconst other = require('./other.ts');\nexport const result = answer();\n");
    const snapshot = buildStructure(root);
    expect(snapshot.edges.filter((edge) => edge.kind === "imports")).toHaveLength(2);
    writeFileSync(join(root, "src/app.ts"), "const target = './math.js';\nexport const result = import(target);\n");
    const dynamic = buildStructure(root), impact = analyzeImpact(dynamic, compareStructure(root, dynamic, "HEAD"));
    expect(dynamic.unknown).toContainEqual(expect.objectContaining({ reason: "dynamic-module-target" }));
    expect(planAffectedChecks(dynamic, impact, checks).omittedCount).toBe(0);
    writeFileSync(join(root, "src/app.ts"), "function require(value: string) { return value; }\nexport const result = require('./math.ts');\n");
    const shadow = buildStructure(root);
    expect(shadow.unknown).toContainEqual(expect.objectContaining({ reason: "shadowed-module-loader" }));
    expect(shadow.edges.filter((edge) => edge.kind === "imports")).toHaveLength(0);
  });
  it("falls back for deletion, global configuration, missing baseline and an empty required selection", () => {
    const root = fixture(); unlinkSync(join(root, "src/math.ts"));
    let snapshot = buildStructure(root), impact = analyzeImpact(snapshot, compareStructure(root, snapshot, "HEAD"));
    expect(planAffectedChecks(snapshot, impact, checks).fallbackReasons).toContain("removed-or-renamed-dependencies-require-baseline-graph");
    writeFileSync(join(root, "src/math.ts"), "export function answer() { return 1; }\n");
    writeFileSync(join(root, "package.json"), '{"type":"module","name":"changed"}');
    snapshot = buildStructure(root); impact = analyzeImpact(snapshot, compareStructure(root, snapshot, "HEAD"));
    expect(planAffectedChecks(snapshot, impact, checks).fallbackReasons).toContain("global-configuration-changed");
    expect(planAffectedChecks(snapshot, analyzeImpact(snapshot), checks).omittedCount).toBe(0);
    const safe: StructureSnapshot = { ...snapshot, unknown: [] };
    const isolated = { ...impact, source: safe.source, changedPaths: ["src/math.ts"], affected: [], fallbackReasons: [] };
    expect(planAffectedChecks(safe, isolated, [checks[2]!]).fallbackReasons).toContain("no-selected-required-check");
    expect(matchImpactPath("**/*.ts", "file.ts")).toBe(true);
    expect(matchImpactPath("src/**", "src/math.ts")).toBe(true);
    expect(() => matchImpactPath("../*", "file.ts")).toThrow(/Invalid/);
  });
});
