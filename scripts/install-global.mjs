#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, renameSync, rmSync } from "node:fs";
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
const migrationVersion = 2;
const requestedRef = process.env.CANARY_REF?.trim();
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
function resolveRef() {
  const r = probe("git", ["rev-parse", "--verify", requestedRef ? `${requestedRef}^{commit}` : "HEAD"]);
  if (r.status !== 0) fail(`CANARY_REF is invalid or unavailable: ${requestedRef}`);
  return r.stdout.trim();
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
  mkdirSync(binDir, { recursive: true });
  const runnerPath = join(binDir, "canary-run.mjs");
  const runner = `import { spawnSync } from "node:child_process";\nimport { existsSync } from "node:fs";\nimport { join } from "node:path";\nconst repoRoot = ${JSON.stringify(repoRoot)};\nconst cli = join(repoRoot, "packages/cli/src/index.ts");\nif (!existsSync(cli)) { console.error("canary install is broken: missing CLI at " + cli); process.exit(1); }\nconst result = spawnSync(process.execPath, ["--import", "tsx", cli, ...process.argv.slice(2)], { cwd: process.cwd(), stdio: "inherit", env: { ...process.env, CANARY_HOME: repoRoot } });\nprocess.exit(result.status ?? 1);\n`;
  writeFileSync(runnerPath, runner, "utf8");
  if (isWin) writeFileSync(join(binDir, "canary.cmd"), `@echo off\r\n"${process.execPath}" "${runnerPath}" %*\r\nexit /b %ERRORLEVEL%\r\n`, "utf8");
  else { const launcher = join(binDir, "canary"); writeFileSync(launcher, `#!/usr/bin/env bash\nexec "${process.execPath}" "${runnerPath}" "$@"\n`, "utf8"); chmodSync(launcher, 0o755); }
}

ensureRuntime();
assertCheckout();
console.log(`Installing Canary from source checkout: ${repoRoot}`);
run("pnpm", ["install", "--frozen-lockfile"]);
run("pnpm", ["build"]);
const ref = resolveRef();
mkdirSync(metaDir, { recursive: true });
const backupDir = join(metaDir, "backups", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(backupDir, { recursive: true });
for (const file of [homeFile, join(binDir, isWin ? "canary.cmd" : "canary"), join(binDir, "canary-run.mjs")]) if (existsSync(file)) copyFileSync(file, join(backupDir, file.split(/[\\/]/).pop()));
const metadata = { root: repoRoot, installedAt: new Date().toISOString(), version: "0.1.0", migrationVersion, sourceInstall: true, node: process.versions.node, pnpm: expectedPnpm, ref, canaryRef: requestedRef ?? "HEAD", binDir };
writeFileSync(homeFile + ".tmp", JSON.stringify(metadata, null, 2), "utf8");
writeLauncher();
const launcher = join(binDir, isWin ? "canary.cmd" : "canary");
if (!existsSync(launcher) || !existsSync(join(binDir, "canary-run.mjs"))) { if (existsSync(homeFile)) copyFileSync(join(backupDir, "home.json"), homeFile); fail("installation state validation failed"); }
renameSync(homeFile + ".tmp", homeFile);
addToPath();
console.log(`Canary installed. Project root remains the caller's current directory; installation root is ${repoRoot}.`);
