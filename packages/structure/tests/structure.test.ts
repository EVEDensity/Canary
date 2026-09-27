import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildStructure, compareStructure, linkCoverage } from "../src/index.js";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "canary-structure-"));
  roots.push(root);
  mkdirSync(join(root, "apps", "web", "src"), { recursive: true });
  mkdirSync(join(root, "packages", "shared", "src"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "example", private: true }));
  writeFileSync(join(root, "apps", "web", "package.json"), JSON.stringify({ name: "@test/web", dependencies: { "@test/shared": "workspace:*" } }));
  writeFileSync(join(root, "packages", "shared", "package.json"), JSON.stringify({ name: "@test/shared" }));
  writeFileSync(join(root, "packages", "shared", "src", "math.ts"), "export function answer() { return 42; }\n");
  writeFileSync(join(root, "apps", "web", "src", "index.ts"), "import { answer } from '../../../packages/shared/src/math.js';\nexport class App { run() { return answer(); } }\n");
  writeFileSync(join(root, "canary.architecture.json"), JSON.stringify({ v: 1, layers: [{ id: "ui", name: "界面", paths: ["apps/**"] }, { id: "logic", name: "逻辑", paths: ["packages/**"] }] }));
  return root;
}
function git(root: string, ...args: string[]) { return execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim(); }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("R10 project structure", () => {
  it("records bounded hierarchy, declared layers, local imports, package dependencies and resolved calls", () => {
    const root = fixture();
    const snapshot = buildStructure(root);
    const app = snapshot.nodes.find((node) => node.kind === "app" && node.path === "apps/web")!;
    const shared = snapshot.nodes.find((node) => node.kind === "package" && node.path === "packages/shared")!;
    const file = snapshot.nodes.find((node) => node.kind === "file" && node.path === "apps/web/src/index.ts")!;
    const target = snapshot.nodes.find((node) => node.kind === "function" && node.symbol === "answer")!;
    expect(file.layerId).toBe("ui");
    expect(app.layerId).toBe("ui");
    expect(shared.layerId).toBe("logic");
    expect(snapshot.nodes.find((node) => node.kind === "class" && node.symbol === "App")).toBeDefined();
    expect(snapshot.edges).toContainEqual(expect.objectContaining({ kind: "package-dependency", from: app.id, to: shared.id, provenance: "static" }));
    expect(snapshot.edges).toContainEqual(expect.objectContaining({ kind: "imports", from: file.id, to: snapshot.nodes.find((node) => node.path === "packages/shared/src/math.ts")?.id }));
    expect(snapshot.edges).toContainEqual(expect.objectContaining({ kind: "calls", to: target.id }));
    const before = target.id;
    writeFileSync(join(root, "packages", "shared", "src", "math.ts"), "\n\nexport function answer() { return 42; }\n");
    expect(buildStructure(root).nodes.find((node) => node.symbol === "answer")?.id).toBe(before);
  });

  it("separates exact coverage links from changed or missing source", () => {
    const root = fixture();
    const snapshot = buildStructure(root);
    const file = snapshot.nodes.find((node) => node.kind === "file" && node.path === "apps/web/src/index.ts")!;
    const coverage = linkCoverage(snapshot, { files: [{ filePath: join(root, file.path), sourceHash: file.sourceHash!, status: "final", lines: { pct: 80 }, branches: { pct: 50 }, uncoveredLocations: [{ start: { line: 2 } }] }] }, root);
      expect(coverage[0]).toMatchObject({ nodeId: file.id, status: "final", provenance: "runtime" });
      expect(linkCoverage(snapshot, { files: [{ filePath: join(root, file.path), sourceHash: file.sourceHash!.slice(0, 16), status: "final", lines: { pct: 80 }, branches: { pct: 50 } }] }, root)[0]).toMatchObject({ nodeId: file.id, provenance: "runtime" });
    expect(linkCoverage(snapshot, { files: [{ filePath: join(root, file.path), sourceHash: "changed", status: "final", lines: {}, branches: {}, uncoveredLocations: [{ start: { line: 2 } }] }] }, root)[0]).toMatchObject({ status: "source-mismatch", provenance: "unknown", uncoveredLocations: [] });
  });

  it("extracts Python classes and functions through the standard AST when Python is installed", () => {
    const root = fixture();
    writeFileSync(join(root, "apps", "web", "src", "worker.py"), "from .tools import work\nclass Worker:\n    def run(self):\n        return work()\n");
    writeFileSync(join(root, "apps", "web", "src", "tools.py"), "def work():\n    return 1\n");
    const snapshot = buildStructure(root);
    if (snapshot.unknown.some((item) => item.reason === "python-ast-unavailable")) return;
    const worker = snapshot.nodes.find((node) => node.path === "apps/web/src/worker.py" && node.symbol === "Worker")!;
    expect(worker.kind).toBe("class");
    expect(snapshot.nodes).toContainEqual(expect.objectContaining({ kind: "function", symbol: "Worker.run", parentId: worker.id }));
    expect(snapshot.edges).toContainEqual(expect.objectContaining({ kind: "imports", from: snapshot.nodes.find((node) => node.path === "apps/web/src/worker.py" && node.kind === "file")?.id, to: snapshot.nodes.find((node) => node.path === "apps/web/src/tools.py" && node.kind === "file")?.id }));
  });

  it("keeps unsupported language symbols explicitly unknown while recognizing their package", () => {
    const root = fixture();
    mkdirSync(join(root, "services", "worker"), { recursive: true });
    writeFileSync(join(root, "services", "worker", "go.mod"), "module example/worker\n");
    writeFileSync(join(root, "services", "worker", "main.go"), "package main\nfunc main() {}\n");
    const snapshot = buildStructure(root);
    expect(snapshot.nodes).toContainEqual(expect.objectContaining({ kind: "app", path: "services/worker" }));
    const file = snapshot.nodes.find((node) => node.path === "services/worker/main.go" && node.kind === "file")!;
    expect(snapshot.unknown).toContainEqual(expect.objectContaining({ from: file.id, kind: "symbols", reason: "symbol-parser-unavailable" }));
    expect(snapshot.unknown).toContainEqual(expect.objectContaining({ kind: "package-dependency", target: "go.mod", reason: "package-dependency-analysis-unavailable" }));
  });

  it("records explicit Git baseline changes and rename continuity without changing the saved snapshot", () => {
    const root = fixture();
    git(root, "init", "-q");
    git(root, "add", ".");
    git(root, "-c", "user.name=Canary Test", "-c", "user.email=test@example.com", "commit", "-qm", "baseline");
    const baseline = buildStructure(root);
    renameSync(join(root, "packages", "shared", "src", "math.ts"), join(root, "packages", "shared", "src", "arithmetic.ts"));
    writeFileSync(join(root, "apps", "web", "src", "index.ts"), "export const changed = true;\n");
    writeFileSync(join(root, "apps", "web", "src", "new.ts"), "export const fresh = true;\n");
    const current = buildStructure(root);
    const diff = compareStructure(root, current, "HEAD");
    expect(diff.entries).toContainEqual(expect.objectContaining({ status: "renamed", previousPath: "packages/shared/src/math.ts", path: "packages/shared/src/arithmetic.ts" }));
    expect(diff.entries).toContainEqual(expect.objectContaining({ status: "modified", path: "apps/web/src/index.ts" }));
    expect(diff.entries).toContainEqual(expect.objectContaining({ status: "added", path: "apps/web/src/new.ts" }));
    expect(baseline.nodes.some((node) => node.path === "packages/shared/src/math.ts")).toBe(true);
    expect(current.nodes.some((node) => node.path === "packages/shared/src/math.ts")).toBe(false);
    expect(readFileSync(join(root, "packages", "shared", "src", "arithmetic.ts"), "utf8")).toContain("answer");
    writeFileSync(join(root, "apps", "web", "src", "new.ts"), "export const altered = true;\n");
    expect(() => compareStructure(root, current, "HEAD")).toThrow(/source changed/);
  });

  it("rejects malformed architecture rules and unsupported Git refs", () => {
    const root = fixture();
    writeFileSync(join(root, "canary.architecture.json"), JSON.stringify({ v: 1, layers: [{ id: "ui", name: "界面", paths: ["../outside/**"] }] }));
    expect(() => buildStructure(root)).toThrow(/Invalid architecture/);
    writeFileSync(join(root, "canary.architecture.json"), JSON.stringify({ v: 1, layers: [] }));
    expect(() => compareStructure(root, buildStructure(root), "--evil")).toThrow(/Invalid Git baseline/);
  });
});
