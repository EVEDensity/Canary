import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "@canary/trace";

export function projectSourceInventory(root: string) {
  const excludedDirectories = [
    ".git",
    ".canary",
    "node_modules",
    "dist",
    "build",
    "__pycache__",
    ".venv",
    "venv",
    "target",
    ".tmp",
  ];
  const files: Array<{ path: string; sha256: string; bytes: number }> = [];
  let totalBytes = 0;
  const walk = (dir: string, prefix: string): void => {
    for (const item of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (item.isSymbolicLink()) continue;
      const file = join(dir, item.name),
        path = prefix + item.name;
      if (item.isDirectory() && !excludedDirectories.includes(item.name)) walk(file, `${path}/`);
      else if (item.isFile() && /\.(?:[cm]?[jt]sx?|py|toml|json|ya?ml|go|rs|lock)$/.test(item.name)) {
        const bytes = statSync(file).size;
        totalBytes += bytes;
        if (files.length >= 10_000 || bytes > 16_777_216 || totalBytes > 268_435_456)
          throw new Error("Source inventory exceeds supported limits");
        files.push({ path, bytes, sha256: sha256(readFileSync(file)) });
      }
    }
  };
  walk(root, "");
  return { v: 1, scope: "recognized-source-and-config-files", excludedDirectories, symlinks: "excluded", files };
}

/** Read-only discovery. Suggestions are declarations, never successful checks. */
export function discoverProject(root: string) {
  const languages: Array<{ language: string; evidence: "declared"; marker: string; suggestions: string[] }> = [];
  if (existsSync(join(root, "package.json"))) {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    languages.push({
      language: "node",
      evidence: "declared",
      marker: "package.json",
      suggestions: Object.keys(pkg.scripts ?? {}).filter((name) => /^(test|lint|typecheck|build)(:|$)/.test(name)),
    });
  }
  const pythonMarker = ["pyproject.toml", "setup.py", "requirements.txt"].find((name) => existsSync(join(root, name)));
  if (pythonMarker)
    languages.push({
      language: "python",
      evidence: "declared",
      marker: pythonMarker,
      suggestions: ["python -m unittest discover (configure the test directory explicitly)"],
    });
  for (const [language, marker] of [
    ["go", "go.mod"],
    ["rust", "Cargo.toml"],
  ]) {
    if (existsSync(join(root, marker!)))
      languages.push({ language: language!, evidence: "declared", marker: marker!, suggestions: [] });
  }
  return {
    v: 1 as const,
    kind: "canary.discovery" as const,
    projectRoot: root,
    status: languages.length ? "declared" : "blocked",
    languages,
    automaticExecution: false,
    reason: languages.length
      ? "Select required checks in canary.project configuration."
      : "Unknown language; declare explicit checks before running CI.",
  };
}
