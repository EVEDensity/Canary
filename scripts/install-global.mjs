#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isWin = platform() === "win32";
const binDir = isWin
  ? join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "canary", "bin")
  : join(homedir(), ".local", "bin");
const metaDir = join(homedir(), ".canary");
const homeFile = join(metaDir, "home.json");
const expectedNodeMajor = 22;
const expectedPnpm = "10.15.0";

function fail(message) {
  console.error(`Canary installation failed: ${message}`);
  process.exit(1);
}
function run(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: "inherit", shell: isWin });
  if (result.status !== 0) fail(`${command} ${args.join(" ")} exited with ${result.status ?? 1}`);
}
function probe(command, args) {
  return spawnSync(command, args, { cwd: repoRoot, stdio: "pipe", shell: isWin, encoding: "utf8" });
}
function ensureRuntime() {
  if (Number(process.versions.node.split(".")[0]) < expectedNodeMajor) {
    fail(`Node.js ${expectedNodeMajor}+ is required; found ${process.versions.node}.`);
  }
  const git = probe("git", ["--version"]);
  if (git.status !== 0) fail("Git is required but was not found on PATH.");
  const pnpm = probe("pnpm", ["--version"]);
  if (pnpm.status !== 0) {
    console.log("pnpm was not found; enabling Corepack…");
    run("corepack", ["enable"]);
    run("corepack", ["prepare", `pnpm@${expectedPnpm}`, "--activate"]);
  } else if (pnpm.stdout.trim() !== expectedPnpm) {
    fail(`pnpm ${expectedPnpm} is required; found ${pnpm.stdout.trim()}. Set up Corepack or install the pinned version.`);
  }
}
function assertCheckout() {
  const gitDir = join(repoRoot, ".git");
  if (!existsSync(gitDir)) fail(`installation root is not a Git checkout: ${repoRoot}`);
  const status = probe("git", ["status", "--porcelain"]);
  if (status.status !== 0) fail("could not inspect the Git checkout.");
  if (status.stdout.trim()) fail(`refusing to update a dirty checkout: ${repoRoot}`);
}
function addToPath() {
  if (isWin) {
    const escaped = binDir.replace(/'/g, "''");
    const script = `$bin='${escaped}'; $path=[Environment]::GetEnvironmentVariable('Path','User'); if ($null -eq $path) { $path='' }; if (($path -split ';') -notcontains $bin) { [Environment]::SetEnvironmentVariable('Path', (($path.TrimEnd(';') + ';' + $bin).Trim(';')), 'User') }`;
    const result = spawnSync("powershell", ["-NoProfile", "-Command", script], { stdio: "inherit" });
    if (result.status !== 0) console.warn(`Could not update PATH automatically. Add this folder manually:\n  ${binDir}`);
    return;
  }
  const rc = join(homedir(), ".profile");
  const line = `export PATH="${binDir}:$PATH"`;
  const current = readFileIfExists(rc);
  if (!current.includes(line)) writeFileSync(rc, `${current.trimEnd()}\n${line}\n`, "utf8");
}
function readFileIfExists(path) { try { return readFileSync(path, "utf8"); } catch { return ""; } }
function writeLauncher() {
  mkdirSync(bi