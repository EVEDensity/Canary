import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";

export const CANARY_HOME_FILE = resolve(homedir(), ".canary", "home.json");

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

/** Walk up from cwd for canary.config.ts, then fall back to the global install registry. */
export function resolveCanaryProjectRoot(cwd?: string): string {
  const start = resolve(cwd ?? process.env.INIT_CWD ?? process.cwd());
  let dir = start;
  while (true) {
    if (existsSync(resolve(dir, "canary.config.ts"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return readInstalledHome() ?? start;
}

export function resolveConfigFile(options: { cwd?: string; configPath?: string } = {}): string {
  if (options.configPath && isAbsolute(options.configPath)) return options.configPath;
  const root = resolveCanaryProjectRoot(options.cwd);
  return resolve(root, options.configPath ?? "canary.config.ts");
}

export function missingConfigMessage(configFile: string): string {
  return [
    `No canary project found at ${configFile}.`,
    "Install once (PowerShell):",
    '  git clone https://github.com/EVEDensity/Canary.git "$env:USERPROFILE\\Canary"; node "$env:USERPROFILE\\Canary\\scripts\\install-global.mjs"',
    "Then reopen the terminal and run: canary run",
  ].join("\n");
}
