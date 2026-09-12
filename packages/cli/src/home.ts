import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import type { ProjectContext } from "@canary/core";

export const CANARY_HOME_FILE = resolve(homedir(), ".canary", "home.json");

export function invocationRoot(cwd?: string): string {
  return resolve(cwd ?? process.env.INIT_CWD ?? process.cwd());
}

export function readInstalledHome(): string | undefined {
  if (process.env.CANARY_HOME) {
    const envHome = resolve(process.env.CANARY_HOME);
    if (existsSync(resolve(envHome, "canary.config.ts"))) return envHome;
  }
  try {
    const parsed = JSON.parse(readFileSync(CANARY_HOME_FILE, "utf8")) as { root?: string };
    if (parsed.root && existsSync(resolve(parsed.root, "canary.config.ts"))) return resolve(parsed.root);
  } catch { /* not installed yet */ }
  return undefined;
}

/**
 * Resolve invocation / project / config / install / artifact roots.
 * Priority: explicit --config → walk up from invocation → CANARY_HOME/install registry → invocation cwd.
 */
export function resolveProjectContext(options: { cwd?: string; configPath?: string } = {}): ProjectContext {
  const invocation = invocationRoot(options.cwd);
  const installRoot = readInstalledHome();

  if (options.configPath) {
    const configFile = isAbsolute(options.configPath) ? options.configPath : resolve(invocation, options.configPath);
    const configRoot = dirname(configFile);
    return {
      v: 1,
      invocationRoot: invocation,
      projectRoot: configRoot,
      configRoot,
      configFile,
      installRoot,
      artifactRoot: resolve(configRoot, ".canary/artifacts"),
      source: "config",
    };
  }

  let dir = invocation;
  while (true) {
    const configFile = resolve(dir, "canary.config.ts");
    if (existsSync(configFile)) {
      return {
        v: 1,
        invocationRoot: invocation,
        projectRoot: dir,
        configRoot: dir,
        configFile,
        installRoot,
        artifactRoot: resolve(dir, ".canary/artifacts"),
        source: "walk",
      };
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  if (installRoot) {
    return {
      v: 1,
      invocationRoot: invocation,
      projectRoot: installRoot,
      configRoot: installRoot,
      configFile: resolve(installRoot, "canary.config.ts"),
      installRoot,
      artifactRoot: resolve(installRoot, ".canary/artifacts"),
      source: "install",
    };
  }

  return {
    v: 1,
    invocationRoot: invocation,
    projectRoot: invocation,
    configRoot: invocation,
    configFile: resolve(invocation, "canary.config.ts"),
    artifactRoot: resolve(invocation, ".canary/artifacts"),
    source: "cwd",
  };
}

/** Walk up from cwd for canary.config.ts, then fall back to the global install registry. */
export function resolveCanaryProjectRoot(cwd?: string): string {
  return resolveProjectContext({ cwd }).projectRoot;
}

export function resolveConfigFile(options: { cwd?: string; configPath?: string } = {}): string {
  return resolveProjectContext(options).configFile;
}

export function missingConfigMessage(configFile: string): string {
  return [
    `No canary project found at ${configFile}.`,
    "Install once:",
    "  Windows: iwr -useb https://raw.githubusercontent.com/EVEDensity/Canary/main/install.ps1 | iex",
    "  macOS/Linux: curl -fsSL https://raw.githubusercontent.com/EVEDensity/Canary/main/install.sh | bash",
    "Then reopen the terminal and run: canary run",
    "Or pass --config <path> to target a specific project.",
  ].join("\n");
}
