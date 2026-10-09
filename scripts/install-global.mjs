#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, cpSync, realpathSync, appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runCommand } from "./lib/command-runner.mjs";
import { publishInstallation, validateInstallation } from "./lib/install-state.mjs";

const source = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const metaDir = resolve(process.env.CANARY_INSTALL_HOME ?? join(homedir(), ".canary"));
const binDir = resolve(
  process.env.CANARY_BIN_DIR ??
    (process.platform === "win32"
      ? join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData/Local"), "canary/bin")
      : join(homedir(), ".local/bin")),
);
const working = process.argv.includes("--working-tree"),
  channel = process.env.CANARY_CHANNEL ?? "stable",
  ref = process.env.CANARY_REF?.trim();
const invoke = (command, args, cwd = source, capture = false) => {
  const result = runCommand(command, args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
    timeout: 600000,
  });
  if (result.status !== 0)
    throw new Error(`Installation command ${command} failed; previous installation was retained`);
  return result.stdout?.trim() ?? "";
};
try {
  if (
    process.argv.slice(2).some((arg) => arg !== "--working-tree") ||
    !["stable", "main"].includes(channel) ||
    (working && ref)
  )
    throw new Error("Choose stable/main or an explicit ref; --working-tree cannot be combined with a ref");
  if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("Node.js 24 or later is required");
  const dirty = invoke("git", ["status", "--porcelain"], source, true) !== "";
  if (dirty && !working)
    throw new Error("Refusing to install an uncommitted checkout; use --working-tree deliberately");
  const tags = invoke(
    "git",
    ["for-each-ref", "--sort=-version:refname", "--format=%(refname:short)", "refs/tags"],
    source,
    true,
  ).split(/\r?\n/);
  const selected = working
    ? "HEAD"
    : (ref ?? (channel === "main" ? "origin/main" : tags.find((tag) => /^v\d+\.\d+\.\d+$/.test(tag))));
  if (!selected || selected.startsWith("-"))
    throw new Error("No stable release tag is available; choose CANARY_CHANNEL=main explicitly");
  const commit = invoke("git", ["rev-parse", "--verify", `${selected}^{commit}`], source, true);
  mkdirSync(join(metaDir, "versions"), { recursive: true });
  const root = join(metaDir, "versions", commit.slice(0, 12) + "-" + randomUUID());
  if (working) {
    cpSync(source, root, {
      recursive: true,
      filter: (path) =>
        !relative(source, path)
          .split(/[\\/]/)
          .some((part) => [".git", ".canary", "node_modules", "dist", ".venv"].includes(part)),
    });
    invoke("git", ["init", "-q"], root);
    if (process.platform === "win32") invoke("git", ["config", "core.longpaths", "true"], root);
    invoke(
      "git",
      ["-c", "protocol.file.allow=always", "fetch", "--no-tags", "--depth=1", pathToFileURL(source).href, commit],
      root,
    );
    invoke("git", ["reset", "--mixed", commit], root);
  } else {
    mkdirSync(root);
    invoke("git", ["init", "-q"], root);
    if (process.platform === "win32") invoke("git", ["config", "core.longpaths", "true"], root);
    invoke(
      "git",
      ["-c", "protocol.file.allow=always", "fetch", "--no-tags", "--depth=1", pathToFileURL(source).href, commit],
      root,
    );
    invoke("git", ["checkout", "--detach", commit], root);
  }
  let pnpmReady = false;
  try {
    pnpmReady = invoke("pnpm", ["--version"], root, true) === "10.15.0";
  } catch {
    /* Fall back to pinned npm exec. */
  }
  const pnpm = (args) =>
    pnpmReady
      ? invoke("pnpm", args, root)
      : invoke("npm", ["exec", "--yes", "--package", "pnpm@10.15.0", "--", "pnpm", ...args], root);
  pnpm(["install", "--frozen-lockfile"]);
  pnpm(["build"]);
  const runtime = validateInstallation(root);
  const metadata = publishInstallation({
    root: realpathSync.native(root),
    binDir,
    metaDir,
    metadata: {
      ...runtime,
      ref: commit,
      commit,
      channel: working ? "working-tree" : ref ? "pinned" : channel,
      sourceRoot: source,
      sourceDirty: dirty,
      migrationVersion: 4,
      sourceInstall: true,
      installedAt: new Date().toISOString(),
      node: process.versions.node,
      pnpm: "10.15.0",
    },
  });
  if (!process.env.CANARY_BIN_DIR) {
    if (process.platform === "win32") {
      const escaped = binDir.replaceAll("'", "''");
      const ps = `$bin='${escaped}'; $path=[Environment]::GetEnvironmentVariable('Path','User'); if ($null -eq $path) {$path=''}; if (($path -split ';') -notcontains $bin) {[Environment]::SetEnvironmentVariable('Path',(($path.TrimEnd(';')+';'+$bin).Trim(';')),'User')}`;
      if (runCommand("powershell", ["-NoProfile", "-Command", ps], { stdio: "inherit" }).status !== 0)
        console.warn("Add the reported launcher directory to PATH");
    } else {
      const profile = join(homedir(), ".profile"),
        shellBin = "'" + binDir.replaceAll("'", "'\\''") + "'",
        line = "export PATH=" + shellBin + ":$PATH";
      const text = existsSync(profile) ? readFileSync(profile, "utf8") : "";
      if (!text.includes(line)) appendFileSync(profile, "\n" + line + "\n");
    }
  }
  console.log(`Canary ${metadata.version} installed (${metadata.commit.slice(0, 12)}, ${metadata.channel})`);
  console.log(`Launcher: ${join(binDir, process.platform === "win32" ? "canary.cmd" : "canary")}`);
  console.log("Open a new terminal, enter your project, then run: canary run --ci");
  console.log("Interactive report: canary run --port 4318");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
