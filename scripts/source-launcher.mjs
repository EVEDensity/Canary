import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Source-checkout launcher. Deliberately does not alter PATH or installation metadata. */
export function writeSourceLauncher(repoRoot, binDir) {
  mkdirSync(binDir, { recursive: true });
  const runnerPath = join(binDir, "canary-run.mjs");
  const runner = `import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
const repoRoot = ${JSON.stringify(repoRoot)};
const cli = join(repoRoot, "packages/cli/dist/index.js");
if (!existsSync(cli)) { console.error("Canary build is missing. Run pnpm build in " + repoRoot); process.exit(4); }
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !["init_cwd", "npm_package_name", "npm_lifecycle_event", "canary_home"].includes(key.toLowerCase())));
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { cwd: process.cwd(), stdio: "inherit", env: { ...env, CANARY_HOME: repoRoot }, windowsHide: true });
if (result.error) console.error("Unable to start the Canary runtime; check the installation and Node executable.");
process.exit(result.status ?? 4);
`;
  writeFileSync(runnerPath, runner, "utf8");
  const launcher = join(binDir, process.platform === "win32" ? "canary.cmd" : "canary");
  if (process.platform === "win32")
    writeFileSync(
      launcher,
      `@echo off\r\n"${process.execPath}" "${runnerPath}" %*\r\nexit /b %ERRORLEVEL%\r\n`,
      "utf8",
    );
  else {
    const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
    writeFileSync(launcher, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(runnerPath)} "$@"\n`, "utf8");
    chmodSync(launcher, 0o755);
  }
  return { runnerPath, launcher };
}
