import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { runLogged } from "./run-logged.mjs";

function pnpmEntry() {
  if (process.env.npm_execpath && existsSync(process.env.npm_execpath)) return process.env.npm_execpath;
  const found = spawnSync(process.platform === "win32" ? "where.exe" : "which", ["pnpm"], { encoding: "utf8", windowsHide: true });
  const candidate = found.status === 0 ? found.stdout.split(/\r?\n/).find((line) => line && existsSync(line) && !/\.cmd$/i.test(line)) : undefined;
  if (!candidate) throw new Error("pnpm runtime not found");
  return candidate;
}

process.env.CANARY_R8_PRESERVE = "1";
const entry = pnpmEntry();
const command = /\.exe$/i.test(entry) ? entry : process.execPath;
const args = command === entry ? ["--filter", "@canary/cli", "exec", "vitest", "run", "tests/r8-closure.test.ts"] : [entry, "--filter", "@canary/cli", "exec", "vitest", "run", "tests/r8-closure.test.ts"];
process.exitCode = (await runLogged("verification/r8", command, args)).exitCode;
