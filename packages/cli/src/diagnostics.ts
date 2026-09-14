import { existsSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";
import { resolveProjectContext } from "./home.js";
import { spawnSync } from "node:child_process";
export const installMetadataPath = join(homedir(), ".canary", "home.json");
export function readInstallMetadata(): Record<string, unknown> | undefined { try { return JSON.parse(readFileSync(installMetadataPath, "utf8")) as Record<string, unknown>; } catch { return undefined; } }
export function diagnosticSnapshot(cwd = process.cwd(), configPath?: string): Record<string, unknown> {
  const invocationRoot = resolve(cwd); const metadata = readInstallMetadata(); const installRoot = typeof metadata?.root === "string" ? resolve(metadata.root) : undefined;
  const context = resolveProjectContext({ cwd, configPath }); const configFile = context.configFile; const projectRoot = context.projectRoot; const artifactRoot = context.artifactRoot;
  const binDir = typeof metadata?.binDir === "string" ? resolve(metadata.binDir) : undefined; const launcher = binDir ? join(binDir, platform() === "win32" ? "canary.cmd" : "canary") : undefined;
  const pnpm = spawnSync("pnpm", ["--version"], { encoding: "utf8", shell: platform() === "win32" }).stdout?.trim() || undefined; const problems: string[] = [];
  if (!installRoot) problems.push("No registered global installation; use a local checkout or install-global.");
  if (installRoot && !existsSync(join(installRoot, "packages", "cli"))) problems.push("Registered installation root is missing packages/cli.");
  if (launcher && !existsSync(launcher)) problems.push("Registered launcher is missing.");
  return { v: 1, invocationRoot, projectRoot, configFile, artifactRoot, installRoot, canaryVersion: typeof metadata?.version === "string" ? metadata.version : "workspace", nodeVersion: process.versions.node, pnpmVersion: pnpm, launcher, exporter: { enabled: false, default: "disabled" }, localFirst: true, problems, suggestions: problems.length ? ["Run canary paths/doctor after checking installation metadata."] : ["No action required."] };
}
