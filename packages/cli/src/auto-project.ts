import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { projectChecksConfigSchema, type ProjectChecksConfig } from "@canary/core";

export const PROJECT_MARKERS = [
  "package.json",
  "pyproject.toml",
  "setup.py",
  "requirements.txt",
  "go.mod",
  "Cargo.toml",
];
export function hasProjectMarker(root: string): boolean {
  return PROJECT_MARKERS.some((name) => existsSync(join(root, name)));
}
export function hasWorkspaceMarker(root: string): boolean {
  if (existsSync(join(root, "pnpm-workspace.yaml"))) return true;
  try {
    return Boolean(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).workspaces);
  } catch {
    return false;
  }
}

/** Build a reproducible check plan from the project's declarations; never write a user config. */
export function automaticProjectConfig(root: string): ProjectChecksConfig {
  const checks: Array<Record<string, unknown>> = [];
  const add = (id: string, command: string, args: string[], cwd = ".") =>
    checks.push({
      id,
      type: "command",
      command,
      args,
      cwd,
      timeoutMs: 300_000,
      envAllowlist: ["CI", "PNPM_HOME"],
    });
  if (existsSync(join(root, "package.json"))) {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8").replace(/^\uFEFF/, ""));
    const declared = typeof pkg.packageManager === "string" ? pkg.packageManager.split("@")[0] : undefined;
    const manager =
      declared ??
      (existsSync(join(root, "pnpm-lock.yaml")) || existsSync(join(root, "pnpm-workspace.yaml"))
        ? "pnpm"
        : existsSync(join(root, "yarn.lock"))
          ? "yarn"
          : existsSync(join(root, "bun.lock")) || existsSync(join(root, "bun.lockb"))
            ? "bun"
            : "npm");
    if (!["npm", "pnpm", "yarn", "bun"].includes(manager)) throw new Error("Unsupported declared package manager");
    const helper = fileURLToPath(new URL("./auto-script.js", import.meta.url));
    const runtime = existsSync(helper)
      ? [helper]
      : ["--import", pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href, helper.replace(/\.js$/, ".ts")];
    const appendScripts = (manifest: typeof pkg, cwd: string, prefix: string) => {
      const scripts = manifest.scripts ?? {};
      const runnable = (name: string) =>
        typeof scripts[name] === "string" &&
        !/(?:^|:)watch(?:$|:)|(?:^|:)dev(?:$|:)|(?:^|:)ui(?:$|:)/.test(name) &&
        !/--watch(?:\s|$|=true)|--watchAll(?:\s|$|=true)|--ui(?:\s|$)/.test(scripts[name]);
      const selected = new Set<string>();
      for (const aliases of [
        ["build"],
        ["typecheck", "type-check", "check:types"],
        ["lint", "lint:check"],
        ["format:check", "format.check", "check:format"],
        ["test:ci", "test:run", "test"],
      ]) {
        const name = aliases.find(runnable);
        if (name) selected.add(name);
      }
      if (![...selected].some((name) => name.startsWith("test")))
        for (const name of Object.keys(scripts).sort())
          if (/^test:(?:unit|integration|e2e)$/.test(name) && runnable(name)) selected.add(name);
      if (!selected.size && runnable("check")) selected.add("check");
      for (const name of selected)
        add(prefix + "." + name.replace(/[^A-Za-z0-9_.-]/g, "."), "node", [...runtime, manager, name], cwd);
    };
    appendScripts(pkg, ".", "node");
    // Workspaces without a root CI script still get checks for their member packages.
    if (!checks.length && hasWorkspaceMarker(root)) {
      const workspacePatterns: string[] = Array.isArray(pkg.workspaces)
        ? pkg.workspaces
        : Array.isArray(pkg.workspaces?.packages)
          ? pkg.workspaces.packages
          : existsSync(join(root, "pnpm-workspace.yaml"))
            ? [
                ...(
                  readFileSync(join(root, "pnpm-workspace.yaml"), "utf8").match(
                    /^packages:\s*\r?\n((?:[ \t]+[^\r\n]*(?:\r?\n|$)|[ \t]*\r?\n)*)/m,
                  )?.[1] ?? ""
                ).matchAll(/^\s*-\s*['"]?([^'"\s#]+)['"]?\s*(?:#.*)?$/gm),
              ].map((match) => match[1]!)
            : [];
      if (!workspacePatterns.length) throw new Error("Workspace members could not be resolved");
      const matches = (cwd: string, pattern: string) =>
        new RegExp(
          "^" +
            pattern
              .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
              .replaceAll("**", "\u0000")
              .replaceAll("*", "[^/]*")
              .replaceAll("\u0000", ".*") +
            "$",
        ).test(cwd.replaceAll("\\", "/"));
      const walk = (dir: string, depth: number) => {
        if (depth > 5) return;
        for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
          if (
            !entry.isDirectory() ||
            entry.isSymbolicLink() ||
            entry.name.startsWith(".") ||
            ["node_modules", "dist", "build", "coverage"].includes(entry.name)
          )
            continue;
          const child = join(dir, entry.name),
            file = join(child, "package.json");
          if (existsSync(file)) {
            const cwd = relative(root, child);
            if (
              workspacePatterns.some((pattern) => !pattern.startsWith("!") && matches(cwd, pattern)) &&
              !workspacePatterns.some((pattern) => pattern.startsWith("!") && matches(cwd, pattern.slice(1)))
            )
              appendScripts(
                JSON.parse(readFileSync(file, "utf8")),
                cwd,
                "node." + cwd.replace(/[^A-Za-z0-9_.-]/g, "."),
              );
          } else walk(child, depth + 1);
        }
      };
      walk(root, 0);
    }
  }
  if (["pyproject.toml", "setup.py", "requirements.txt"].some((name) => existsSync(join(root, name)))) {
    const executable =
      [
        join(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python"),
        join(root, "venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python"),
      ].find(existsSync) ?? (process.platform === "win32" ? "python" : "python3");
    const declarations = ["pyproject.toml", "requirements.txt"]
      .filter((name) => existsSync(join(root, name)))
      .map((name) => readFileSync(join(root, name), "utf8"))
      .join("\n");
    if (/\bpytest\b/.test(declarations) || existsSync(join(root, "pytest.ini")))
      add("python.test", executable, ["-m", "pytest"]);
    else
      add("python.test", executable, [
        "-c",
        "import unittest,sys; s=unittest.defaultTestLoader.discover('tests' if __import__('os').path.isdir('tests') else '.'); n=s.countTestCases(); print('Discovered %d tests' % n); sys.exit(2) if not n else sys.exit(0 if unittest.TextTestRunner(verbosity=2).run(s).wasSuccessful() else 1)",
      ]);
  }
  if (existsSync(join(root, "go.mod"))) {
    add("go.vet", "go", ["vet", "./..."]);
    add("go.test", "go", ["test", "./..."]);
  }
  if (existsSync(join(root, "Cargo.toml"))) {
    add("rust.check", "cargo", ["check", "--all-targets"]);
    add("rust.test", "cargo", ["test", "--all-targets"]);
  }
  if (!checks.length) throw new Error("No executable project checks found");
  return projectChecksConfigSchema.parse({
    kind: "canary.project",
    version: 1,
    budgetMs: Math.min(86_400_000, Math.max(600_000, checks.length * 300_000)),
    checks,
  });
}
