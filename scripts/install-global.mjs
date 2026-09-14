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
    run("c