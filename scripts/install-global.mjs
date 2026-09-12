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
const runnerPath = join(binDir, "canary-run.mjs");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: isWin,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function ensurePnpm() {
  const probe = spawnSync("pnpm", ["--version"], { stdio: "pipe", shell: isWin });
  if (probe.status === 0) return;
  console.log("Enabling Corepack and preparing pnpm…");
  run("corepack", ["enable"]);
  run("corepack", ["prepare", "pnpm@10.15.0", "--activate"]);
}

function addToPath() {
  if (isWin) {
    const escaped = binDir.replace(/'/g, "''");
    const script = `
$bin = '${escaped}'
$path = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($null -eq $path) { $path = '' }
if ($path.Split(';') -notcontains $bin) {
  [Environment]::SetEnvironmentVariable('Path', ($path.TrimEnd(';') + ';' + $bin).Trim(';'), 'User')
}
`;
    const result = spawnSync("powershell", ["-NoProfile", "-Command", script], { stdio: "inherit" });
    if (result.status !== 0) {
      console.warn(`Could not update PATH automatically. Add this folder manually:\n  ${binDir}`);
    }
    return;
  }
  const rc = join(homedir(), ".profile");
  const line = `export PATH="${binDir}:$PATH"`;
  if (existsSync(rc)) {
    const current = readFileIfExists(rc);
    if (!current.includes(binDir)) writeFileSync(rc, `${current.trimEnd()}\n${line}\n`, "utf8");
  } else {
    writeFileSync(rc, `${line}\n`, "utf8");
  }
}

function readFileIfExists(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function writeLauncher() {
  mkdirSync(binDir, { recursive: true });
  const repoLiteral = JSON.stringify(repoRoot);
  const runner = `import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const repoRoot = ${repoLiteral};
const cli = join(repoRoot, "packages/cli/src/index.ts");
if (!existsSync(cli)) {
  console.error("canary install is broken: missing CLI at " + cli);
  process.exit(1);
}
const result = spawnSync(process.execPath, ["--import", "tsx", cli, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  stdio: "inherit",
  env: { ...process.env, CANARY_HOME: repoRoot },
});
process.exit(result.status ?? 1);
`;
  writeFileSync(runnerPath, runner, "utf8");

  if (isWin) {
    const cmdPath = join(binDir, "canary.cmd");
    writeFileSync(
      cmdPath,
      `@echo off\r\n"${process.execPath}" "${runnerPath}" %*\r\nexit /b %ERRORLEVEL%\r\n`,
      "utf8",
    );
  } else {
    const shPath = join(binDir, "canary");
    writeFileSync(
      shPath,
      `#!/usr/bin/env bash\nexec "${process.execPath}" "${runnerPath}" "$@"\n`,
      "utf8",
    );
    chmodSync(shPath, 0o755);
  }
}

console.log(`Installing canary from ${repoRoot}`);
ensurePnpm();
run("pnpm", ["install", "--frozen-lockfile"]);
run("pnpm", ["build"]);

mkdirSync(metaDir, { recursive: true });
writeFileSync(
  homeFile,
  JSON.stringify({ root: repoRoot, installedAt: new Date().toISOString(), version: "0.1.0" }, null, 2),
  "utf8",
);
writeLauncher();
addToPath();

console.log("");
console.log("canary is installed globally.");
console.log(`  project: ${repoRoot}`);
console.log(`  command: ${join(binDir, isWin ? "canary.cmd" : "canary")}`);
console.log(`  registry: ${homeFile}`);
console.log("");
console.log("Open a new terminal, then run:");
console.log("  canary run");
