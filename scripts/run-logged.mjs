import { spawn, spawnSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { newLogDirectory, repositoryRoot } from "./lib/evidence-output.mjs";
import { DiagnosticOutput } from "../packages/cli/dist/diagnostic-output.js";
import { writePrivateJson, writePrivateText } from "../packages/trace/dist/index.js";
import { killProcessTree } from "../packages/isolation/dist/index.js";

export async function runLogged(category, command, args, options = {}) {
  const dir = newLogDirectory(category, options.root),
    startedAt = new Date().toISOString();
  const stdout = new DiagnosticOutput(process.env),
    stderr = new DiagnosticOutput(process.env);
  const lock = join(dir, "run.lock");
  writePrivateJson(lock, { pid: process.pid, startedAt });
  writePrivateJson(join(dir, "result.json"), { kind: "canary.local-log", status: "running", startedAt });
  console.error(`Test logs: ${dir}`);
  return await new Promise((resolveResult) => {
    let completed = false;
    const child = spawn(command, args, {
      cwd: options.cwd ?? repositoryRoot,
      env: { ...process.env, CANARY_LOG_DIR: dir },
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let interrupted = false;
    const onInterrupt = () => {
      interrupted = true;
      if (child.pid) killProcessTree(child.pid);
    };
    process.once("SIGINT", onInterrupt);
    process.once("SIGTERM", onInterrupt);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout.append(chunk);
      if (!options.quiet) process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr.append(chunk);
      if (!options.quiet) process.stderr.write(chunk);
    });
    const finish = (code, signal, error) => {
      if (completed) return;
      completed = true;
      process.off("SIGINT", onInterrupt);
      process.off("SIGTERM", onInterrupt);
      const out = stdout.finish(),
        err = stderr.finish();
      let exitCode = interrupted ? 130 : (code ?? 1);
      try {
        writePrivateText(join(dir, "stdout.log"), out.lines.join("\n"));
        writePrivateText(join(dir, "stderr.log"), err.lines.join("\n"));
        writePrivateJson(join(dir, "result.json"), {
          kind: "canary.local-log",
          status: interrupted || error || signal ? "interrupted" : exitCode === 0 ? "passed" : "failed",
          startedAt,
          finishedAt: new Date().toISOString(),
          exitCode,
          signal,
          error: error?.message,
          truncated: out.truncated || err.truncated,
          policy: "bounded-redacted-lines-v1",
        });
        unlinkSync(lock);
      } catch (error) {
        console.error("Cannot persist test logs:", error.code ?? "write failed");
        exitCode ||= 5;
      }
      resolveResult({ exitCode, directory: dir });
    };
    child.on("error", (error) => finish(1, undefined, error));
    child.on("close", (code, signal) => finish(code, signal));
  });
}

function resolvePnpmEntry() {
  if (process.env.npm_execpath && existsSync(process.env.npm_execpath)) return process.env.npm_execpath;
  const lookup = spawnSync(process.platform === "win32" ? "where.exe" : "which", ["pnpm"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const candidates =
    lookup.status === 0 ? lookup.stdout.split(/\r?\n/).filter((entry) => entry && existsSync(entry)) : [];
  return process.platform === "win32"
    ? (candidates.find((entry) => /\.exe$/i.test(entry)) ?? candidates[0])
    : candidates[0];
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [category, separator, binary, ...args] = process.argv.slice(2);
  if (separator !== "--" || !binary) throw new Error("Usage: run-logged <category> -- node|pnpm <args>");
  let command = binary;
  if (binary === "node") command = process.execPath;
  if (binary === "pnpm") {
    const entry = resolvePnpmEntry();
    if (!entry) throw new Error("Cannot resolve pnpm from the current environment");
    if (/\.exe$/i.test(entry)) command = entry;
    else {
      command = process.execPath;
      args.unshift(entry);
    }
  }
  process.exitCode = (await runLogged(category, command, args)).exitCode;
}
