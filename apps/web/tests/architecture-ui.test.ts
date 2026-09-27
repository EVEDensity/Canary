import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildStructure } from "@canary/structure";
import { renderWorkspace } from "../src/workspace-ui.js";
import { readStructureSource } from "../src/structure-source.js";

describe("architecture map", () => {
  it("renders a parseable client with both views, navigation and detail controls", () => {
    const page = renderWorkspace();
    const script = page.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    expect(() => new Function(script)).not.toThrow();
    for (const control of ["architecture-2d", "architecture-3d", "architecture-search", "architecture-scope", "architecture-relation", "architecture-breadcrumb", "architecture-tree", "architecture-detail"])
      expect(page).toContain(`id="${control}"`);
    expect(page).toContain('data-go="structure"');
    expect(page.indexOf('class="surface architecture-entry"')).toBeLessThan(page.indexOf('class="dashboard-toolbar"'));
  });

  it("withholds source when a dirty non-Git file no longer matches the sealed hash", () => {
    const root = mkdtempSync(join(tmpdir(), "canary-r11-source-"));
    const file = join(root, "entry.ts");
    writeFileSync(file, "export function original() { return 1; }\n");
    const snapshot = buildStructure(root);
    const node = snapshot.nodes.find((item) => item.kind === "function" && item.name === "original");
    expect(node).toBeDefined();
    expect(readStructureSource(snapshot, node!.id)?.availability).toBe("current-hash-match");
    writeFileSync(file, "export function original() { return 2; }\n");
    const source = readStructureSource(snapshot, node!.id);
    expect(source?.availability).toBe("unavailable");
    expect(source?.lines).toBeUndefined();
  });
  it("recovers exact CRLF bytes from the normalized Git blob after a Windows file is edited", () => {
    const root = mkdtempSync(join(tmpdir(), "canary-r15-crlf-"));
    try {
      const file = join(root, "entry.ts"), original = "export function original() {\r\n  return 1;\r\n}\r\n";
      writeFileSync(file, original);
      const git = (...args: string[]) => execFileSync("git", args, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
      git("init", "-q"); git("config", "core.autocrlf", "true"); git("add", "."); git("-c", "user.name=Canary Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "CRLF baseline");
      expect(git("show", "HEAD:entry.ts").toString()).not.toContain("\r\n");
      const snapshot = buildStructure(root), node = snapshot.nodes.find((item) => item.kind === "function" && item.name === "original")!;
      writeFileSync(file, "export function changed() { return 2; }\n");
      const restored = readStructureSource(snapshot, node.id);
      expect(restored?.availability).toBe("git-hash-match"); expect(restored?.lines).toContain("  return 1;");
      expect(restored?.lines).not.toContain("export function changed() { return 2; }");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
