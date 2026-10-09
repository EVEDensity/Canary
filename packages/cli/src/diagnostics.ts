import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { automaticProjectConfig } from "./auto-project.js";
import {
  CLI_EXIT,
  doctorSnapshotSchema,
  parseCanaryConfig,
  projectChecksConfigSchema,
  type ProjectChecksConfig,
  pathsSnapshotSchema,
  versionSnapshotSchema,
  type CanaryConfig,
  type CliExitCode,
  type CliIssue,
  type ProjectContext,
} from "@canary/core";
import {
  CANARY_HOME_FILE,
  canonicalPath,
  installationMetadata,
  isInsideRoot,
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

function defaultExport(module: Record<string, unknown>): unknown {
  const value = module.default;
  return value && typeof value === "object" && "default" in value ? (value as Record<string, unknown>).default : value;
}

async function loadConfigFile(configFile: string): Promise<CanaryConfig | ProjectChecksConfig> {
  const url = pathToFileURL(configFile).href;
  let mod: Record<string, unknown>;
  if (configFile.endsWith(".json")) {
    mod = { default: JSON.parse(readFileSync(configFile, "utf8").replace(/^\uFEFF/, "")) };
  } else if (/\.[cm]?tsx?$/.test(configFile)) {
    const { tsImport } = await import("tsx/esm/api");
    mod = (await tsImport(url, { parentURL: import.meta.url })) as Record<string, unknown>;
  } else {
    mod = (await import(url)) as Record<string, unknown>;
  }
  const value = defaultExport(mod);
  if (value && typeof value === "object" && "kind" in value && value.kind === "canary.project")
    return projectChecksConfigSchema.parse(value);
  return parseCanaryConfig(value) as CanaryConfig;
}

async function withSilencedConsole<T>(fn: () => Promise<T>): Promise<T> {
  const original = {
    log: console.log,
    info: console.info,
    debug: console.debug,
    warn: console.warn,
    error: console.error,
  };
  console.log = console.info = console.debug = console.warn = console.error = () => undefined;
  try {
    return await fn();
  } finally {
    Object.assign(console, original);
  }
}

function artifactRootWritable(artifactRoot: string, projectRoot: string): boolean {
  try {
    if (existsSync(artifactRoot)) {
      if (!statSync(artifactRoot).isDirectory()) return false;
      const probe = join(artifactRoot, `.doctor-write-${process.pid}-${randomUUID()}`);
      writeFileSync(probe, "", { flag: "wx" });
      unlinkSync(probe);
      return true;
    }
    const canaryDir = join(projectRoot, ".canary");
    if (existsSync(canaryDir) && !statSync(canaryDir).isDirectory()) return false;
    if (!existsSync(projectRoot) || !statSync(projectRoot).isDirectory()) return false;
    const probe = join(projectRoot, `.doctor-write-${process.pid}-${randomUUID()}`);
    writeFileSync(probe, "", { flag: "wx" });
    unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function doctorExitCode(issues: readonly CliIssue[]): CliExitCode {
  const errors = issues.filter((issue) => issue.severity === "error").map((issue) => issue.code);
  if (
    errors.includes("CONFIG_NOT_FOUND") ||
    errors.includes("CONFIG_INVALID") ||
    errors.includes("AGENT_ENTRY_MISSING")
  )
    return CLI_EXIT.configuration;
  if (errors.includes("ARTIFACT_UNWRITABLE")) return CLI_EXIT.artifact;
  if (errors.length) return CLI_EXIT.configuration;
  return CLI_EXIT.success;
}

function hasWhitespace(path: string): boolean {
  return /\s/.test(path);
}

async function inspectTrustedConfig(context: ProjectContext, issues: CliIssue[]): Promise<void> {
  if (!existsSync(context.configFile)) {
    if (context.source !== "config") {
      try { automaticProjectConfig(context.projectRoot); return; } catch { /* Report absent or unsupported checks below. */ }
    }
    issues.push({
      code: "CONFIG_NOT_FOUND",
      severity: "error",
      message: missingConfigMessage(context.configFile),
      suggestion: "Run canary paths --json, then pass --config <existing-canary.config.ts>.",
    });
    return;
  }
  if (!statSync(context.configFile).isFile()) {
    issues.push({
      code: "CONFIG_INVALID",
      severity: "error",
      message: "The resolved configuration path exists but is not a file.",
      suggestion: "Pass --config to a canary.config.ts file, not a directory.",
    });
    return;
  }
  try {
    const config = await withSilencedConsole(() => loadConfigFile(context.configFile));
    if ("agent" in config && config.agent.adapter === "function") {
      const entry = resolve(context.projectRoot, config.agent.entry);
      if (!existsSync(entry) || !statSync(entry).isFile()) {
        issues.push({
          code: "AGENT_ENTRY_MISSING",
          severity: "error",
          message: "The configured function-agent entry is not a file.",
          suggestion: "Correct agent.entry relative to projectRoot, or pass --entry when running.",
        });
      }
    }
  } catch {
    issues.push({
      code: "CONFIG_INVALID",
      severity: "error",
      message: "Cannot load or validate the project configuration.",
      suggestion:
        "Check canary.config.ts against the documented schema. Config modules are trusted executable code; secret-bearing exceptions are not printed.",
    });
  }
}

export async function diagnosticSnapshot(cwd?: string, configPath?: string) {
  const context = resolveProjectContext({ cwd, configPath });
  const metadata = installationMetadata();
  const binDir = metadata.value?.binDir;
  const launcher = typeof binDir === "string" ? join(binDir, platform() === "win32" ? "canary.cmd" : "canary") : null;
  const pnpmProbe = spawnSync(
    platform() === "win32" ? "cmd.exe" : "pnpm",
    platform() === "win32" ? ["/d", "/s", "/c", "pnpm --version"] : ["--version"],
    // Probe the installed executable outside project discovery. A project packageManager
    // pin can otherwise make pnpm download another version into an isolated user home.
    { cwd: dirname(process.execPath), encoding: "utf8", timeout: 3000, windowsHide: true },
  );
  const pnpmVersion = pnpmProbe.status === 0 ? pnpmProbe.stdout?.trim() || null : null;
  const issues: CliIssue[] = [];
  await inspectTrustedConfig(context, issues);
  if (existsSync(context.projectRoot) && !artifactRootWritable(context.artifactRoot, context.projectRoot))
    issues.push({
      code: "ARTIFACT_UNWRITABLE",
      severity: "error",
      message: "The project artifact collection is not writable.",
      suggestion:
        "Ensure projectRoot/.canary/artifacts is a writable directory; do not replace it with a file, and do not delete historical runs.",
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
  if (
    context.installRoot &&
    canonicalPath(context.projectRoot) === canonicalPath(context.installRoot) &&
    !isInsideRoot(context.invocationRoot, context.installRoot)
  )
    issues.push({
      code: "PROJECT_INSTALL_CONFLICT",
      severity: "warning",
      message:
        "projectRoot equals installRoot while invocationRoot is outside the Canary installation. This diagnoses the installation checkout, not the calling directory.",
      suggestion:
        "Place canary.config.ts in the tested project or pass --config <that-project>/canary.config.ts. The installation demo is never an implicit fallback.",
    });
  if (canonicalPath(context.invocationRoot) !== context.invocationRoot)
    issues.push({
      code: "PATH_ALIAS",
      severity: "warning",
      message: "invocationRoot is a symlink or junction alias of a different canonical directory.",
      suggestion:
        "Use the canonical projectRoot from canary paths --json when passing --config; do not merge Unix case-different directories.",
    });
  const spaced = [
    context.invocationRoot,
    context.projectRoot,
    context.artifactRoot,
    context.configFile,
    context.installRoot ?? "",
  ].filter((path) => path && hasWhitespace(path));
  if (spaced.length)
    issues.push({
      code: "PATH_SPACES",
      severity: "warning",
      message: "One or more roots contain whitespace.",
      suggestion: 'Quote --config paths in the shell, for example --config "C:\\path with spaces\\canary.config.ts".',
    });
  if (!isInsideRoot(context.projectRoot, homedir()))
    issues.push({
      code: "NON_DEFAULT_USER_DIR",
      severity: "warning",
      message: "projectRoot is outside the current user profile directory.",
      suggestion: "Confirm this is the intended project and that artifactRoot is writable on this volume.",
    });
  if (!pnpmVersion)
    issues.push({
      code: "PNPM_UNAVAILABLE",
      severity: "warning",
      message: "pnpm could not be queried within 3 seconds; a built CLI does not need pnpm to run cases.",
      suggestion: "For source builds install the version pinned in package.json; do not automatically upgrade it.",
    });
  const version = versionSnapshot();
  if (metadata.value?.version && metadata.value.version !== version.canaryVersion) issues.push({ code: "INSTALL_VERSION_MISMATCH", severity: "warning", message: "Executing version differs from the installation record.", suggestion: "Run canary installation --json; upgrade or restore a verified installation." });
  const runtimeFile = join(RUNTIME_INSTALL_ROOT, "packages/cli/dist/index.js");
  if (typeof metadata.value?.cliHash === "string" && (!existsSync(runtimeFile) || metadata.value.cliHash !== createHash("sha256").update(readFileSync(runtimeFile)).digest("hex"))) issues.push({ code: "INSTALL_HASH_MISMATCH", severity: "warning", message: "CLI bytes differ from the installation record.", suggestion: "Reinstall a verified release; do not regenerate integrity hashes over modified runtime files." });
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
    exitCode: doctorExitCode(issues),
    issues,
    problems: issues.map((i) => i.message),
    suggestions: issues.length ? issues.map((i) => i.suggestion) : ["No action required."],
  });
}
