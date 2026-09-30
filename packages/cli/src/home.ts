import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, basename, relative, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { projectContextSchema, type ProjectContext } from "@canary/core";
import { hasProjectMarker, hasWorkspaceMarker } from "./auto-project.js";

export const CANARY_HOME_FILE = resolve(homedir(), ".canary", "home.json");
export const RUNTIME_INSTALL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export function invocationRoot(cwd?: string): string {
  // pnpm's package script changes cwd; an unrelated inherited INIT_CWD must not redirect a global CLI.
  const packageScript =
    process.env.npm_package_name === "@canary/cli" &&
    ["canary", "dev"].includes(process.env.npm_lifecycle_event ?? "") &&
    canonicalPath(process.cwd()) === canonicalPath(resolve(RUNTIME_INSTALL_ROOT, "packages/cli"));
  return resolve((packageScript ? process.env.INIT_CWD : undefined) ?? process.cwd(), cwd ?? ".");
}
export function canonicalPath(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync.native(absolute);
  } catch {
    return absolute;
  }
}

/** True when child is the parent or a descendant. Uses canonical existing paths; missing paths stay resolved. */
export function isInsideRoot(child: string, parent: string): boolean {
  const c = canonicalPath(child);
  const p = canonicalPath(parent);
  if (c === p) return true;
  const rel = relative(p, c);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}
export function installationMetadata(file = CANARY_HOME_FILE): {
  status: "valid" | "missing" | "invalid";
  value?: Record<string, unknown>;
} {
  if (!existsSync(file)) return { status: "missing" };
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      !("root" in value) ||
      typeof value.root !== "string" ||
      !value.root.trim() ||
      !isAbsolute(value.root) ||
      ("binDir" in value && (typeof value.binDir !== "string" || !isAbsolute(value.binDir)))
    )
      return { status: "invalid" };
    return { status: "valid", value: value as Record<string, unknown> };
  } catch {
    return { status: "invalid" };
  }
}
export function readInstalledHome(): string | undefined {
  if (process.env.CANARY_HOME?.trim()) return canonicalPath(process.env.CANARY_HOME);
  const root = installationMetadata().value?.root;
  return typeof root === "string" ? canonicalPath(root) : undefined;
}

/** --config > nearest configured directory (project JSON before legacy TS) > invocation (missing config).
 * Installation metadata never selects the tested project. No config module is executed here.
 */
export function resolveProjectContext(options: { cwd?: string; configPath?: string } = {}): ProjectContext {
  const invocation = invocationRoot(options.cwd);
  const installRoot = readInstalledHome() ?? canonicalPath(RUNTIME_INSTALL_ROOT);
  let configFile = options.configPath
    ? resolve(invocation, options.configPath)
    : resolve(invocation, "canary.config.ts");
  let source: "config" | "walk" | "cwd" = options.configPath ? "config" : "cwd";
  if (!options.configPath) {
    let dir = invocation;
    let automaticRoot: string | undefined;
    let workspaceRoot: string | undefined;
    while (true) {
      // Artifact/tmp projects must never inherit the owning project's plan.
      if (basename(dir).toLowerCase() === ".canary") break;
      const selected = ["canary.project.json", "canary.config.ts"].find((name) => existsSync(resolve(dir, name)));
      if (selected) {
        configFile = resolve(dir, selected);
        source = "walk";
        break;
      }
      if (!automaticRoot && hasProjectMarker(dir)) automaticRoot = dir;
      if (hasWorkspaceMarker(dir)) workspaceRoot = dir;
      if (existsSync(resolve(dir, ".git"))) break;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    if (source === "cwd" && (workspaceRoot || automaticRoot)) {
      configFile = resolve(workspaceRoot ?? automaticRoot!, "canary.config.ts");
      source = "walk";
    }
  }
  configFile = canonicalPath(configFile);
  const projectRoot = canonicalPath(dirname(configFile));
  return projectContextSchema.parse({
    v: 1,
    invocationRoot: invocation,
    projectRoot,
    configRoot: projectRoot,
    configFile,
    installRoot,
    artifactRoot: resolve(projectRoot, ".canary", "artifacts"),
    source,
  });
}
export function resolveCanaryProjectRoot(cwd?: string): string {
  return resolveProjectContext({ cwd }).projectRoot;
}
export function resolveConfigFile(options: { cwd?: string; configPath?: string } = {}): string {
  return resolveProjectContext(options).configFile;
}
export function missingConfigMessage(configFile: string): string {
  return `No Canary project configuration found at ${configFile}.\nRun from the tested project or create canary.project.json / canary.config.ts, or pass --config <path>.\nInstalling Canary does not configure the tested project; the installation demo is never an implicit fallback.`;
}
