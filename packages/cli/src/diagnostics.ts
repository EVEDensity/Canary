import { existsSync, readFileSync } from "node:fs";
import { platform } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  CLI_EXIT,
  doctorSnapshotSchema,
  pathsSnapshotSchema,
  versionSnapshotSchema,
  type CliIssue,
} from "@canary/core";
import {
  CANARY_HOME_FILE,
  installationMetadata,
  resolveProjectContext,
  RUNTIME_INSTALL_ROOT,
  missingConfigMessage,
} from "./home.js";

export const installMetadataPath = CANARY_HOME_FILE;
export function readInstallMetadata(): Record<string, unknown> | undefined {
  return installationMetadata().value;
}
export function versionSnapshot() {
  // Version belongs to the executable, not to stale user installation metadata.
  const pkg = JSON.parse(readFileSync(join(RUNTIME_INSTALL_ROOT, "packages/cli/package.json"), "utf8")) as {
    version: string;
  };
  return versionSnapshotSchema.parse({
    v: 1,
    kind: "canary.version",
    canaryVersion: pkg.version,
    nodeVersion: process.versions.node,
  });
}
export function pathsSnapshot(cwd?: string, configPath?: string) {
  return pathsSnapshotSchema.parse({ ...resolveProjectContext({ cwd, configPath }), kind: "canary.paths" });
}
export function diagnosticSnapshot(cwd?: string, configPath?: string) {
  const context = resolveProjectContext({ cwd, configPath });
  const metadata = installationMetadata();
  const binDir = metadata.value?.binDir;
  const launcher = typeof binDir === "string" ? join(binDir, platform() === "win32" ? "canary.cmd" : "canary") : null;
  const pnpmProbe = spawnSync(
    platform() === "win32" ? "cmd.exe" : "pnpm",
    platform() === "win32" ? ["/d", "/s", "/c", "pnpm --version"] : ["--version"],
    { encoding: "utf8", timeout: 3000, windowsHide: true },
  );
  const pnpmVersion = pnpmProbe.status === 0 ? pnpmProbe.stdout?.trim() || null : null;
  const issues: CliIssue[] = [];
  if (!existsSync(context.configFile))
    issues.push({
      code: "CONFIG_NOT_FOUND",
      severity: "error",
      message: missingConfigMessage(context.configFile),
      suggestion: "Run canary paths --json, then pass --config <existing-canary.config.ts>.",
    });
  if (metadata.status === "invalid")
    issues.push({
      code: "INSTALL_METADATA_INVALID",
      severity: "warning",
      message: "Installation metadata is not a valid object with a root path.",
      suggestion: "Back up ~/.canary/home.json and re-run the source install-global script from the intended checkout.",
    });
  if (launcher && !existsSync(launcher))
    issues.push({
      code: "LAUNCHER_MISSING",
      severity: "warning",
      message: "The registered launcher is missing.",
      suggestion: "Re-run install-global from the intended checkout; a local source CLI remains usable.",
    });
  if (context.installRoot && !existsSync(join(context.installRoot, "packages", "cli")))
    issues.push({
      code: "INSTALL_ROOT_MISSING",
      severity: "warning",
      message: "The selected install root has no packages/cli directory.",
      suggestion: "Correct CANARY_HOME or back up and repair the installation registry.",
    });
  if (!pnpmVersion)
    issues.push({
      code: "PNPM_UNAVAILABLE",
      severity: "warning",
      message: "pnpm could not be queried within 3 seconds; a built CLI does not need pnpm to run cases.",
      suggestion: "For source builds install the version pinned in package.json; do not automatically upgrade it.",
    });
  const version = versionSnapshot();
  return doctorSnapshotSchema.parse({
    ...context,
    kind: "canary.doctor",
    canaryVersion: version.canaryVersion,
    nodeVersion: version.nodeVersion,
    pnpmVersion,
    launcher,
    metadataStatus: metadata.status,
    exporter: { enabled: false, default: "disabled" },
    localFirst: true,
    exitCode: issues.some((i) => i.severity === "error") ? CLI_EXIT.configuration : CLI_EXIT.success,
    issues,
    problems: issues.map((i) => i.message),
    suggestions: issues.length ? issues.map((i) => i.suggestion) : ["No action required."],
  });
}
