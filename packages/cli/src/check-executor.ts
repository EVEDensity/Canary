import { spawn } from "node:child_process";
import { createReadStream, existsSync, lstatSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, toNamespacedPath } from "node:path";
import { performance } from "node:perf_hooks";
import { freemem } from "node:os";
import { statfsSync } from "node:fs";
import type { ProjectCheck, ProjectCheckResult } from "@canary/core";
import { killProcessTree, waitForExit } from "@canary/isolation";
import { isolatedEnv, type ExecutionWorkspace } from "@canary/runner";

export type CheckOutcome = Pick<ProjectCheckResult, "status" | "exitCode" | "category"> & Partial<ProjectCheckResult>;
export const ok = (): CheckOutcome => ({ status: "passed", exitCode: 0, category: "none" });
export const blocked = (exitCode: number, category: ProjectCheckResult["category"]): CheckOutcome => ({
  status: "blocked",
  exitCode,
  category,
});
export class CheckPathError extends Error {}
export function projectPath(root: string, path: string): string {
  const target = resolve(root, path);
  // Check the nearest existing ancestor too, so missing children of symlinks cannot escape.
  let ancestor = target;
  while (!existsSync(ancestor)) {
    const parent = resolve(ancestor, "..");
    if (parent === ancestor) break;
    ancestor = parent;
  }
  const real = existsSync(ancestor) ? realpathSync(ancestor) : ancestor;
  for (const candidate of [target, real]) {
    const rel = relative(realpathSync(root), candidate);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..\\`) || rel.startsWith("../"))
      throw new CheckPathError("CHECK_PATH_OUTSIDE_PROJECT");
  }
  return target;
}
const runtimeEnv = ["PATH", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT"];
export function checkEnvironment(check: ProjectCheck, workspace: ExecutionWorkspace): NodeJS.ProcessEnv {
  const names = new Set([...runtimeEnv, ...check.envAllowlist].map((name) => name.toUpperCase()));
  return isolatedEnv(
    workspace.tmpDir,
    { CANARY_RUN_ID: workspace.runId, CANARY_WORKDIR: workspace.workDir },
    Object.fromEntries(Object.entries(process.env).filter(([name]) => names.has(name.toUpperCase()))),
  );
}

/** argv is never passed through a shell. Windows .cmd scripts must use an explicit runtime. */
export async function runCheckProcess(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
  onPid: (pid: number) => void,
  readyText?: string,
): Promise<CheckOutcome> {
  if (signal.aborted) return blocked(3, "cancelled");
  return new Promise((resolveResult) => {
    const child = spawn(command === "node" ? process.execPath : command, args, {
      // Short extended paths break cmd.exe / Node --run on Windows.
      cwd: process.platform === "win32" && cwd.length >= 260 ? toNamespacedPath(cwd) : cwd,
      env,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "",
      outputTruncated = false,
      ready = false,
      done = false;
    const finish = (outcome: CheckOutcome): void => {
      if (done) return;
      done = true;
      signal.removeEventListener("abort", abort);
      void (async () => {
        if (child.pid) {
          killProcessTree(child.pid);
          if (!(await waitForExit(child.pid))) outcome = blocked(4, "environment");
        }
        child.stdout?.destroy();
        child.stderr?.destroy();
        resolveResult({
          ...outcome,
          command,
          args,
          stdout: outputTruncated ? "[output omitted: limit exceeded]" : stdout,
          stderr: outputTruncated ? "[output omitted: limit exceeded]" : stderr,
          outputTruncated,
        });
      })();
    };
    child.stdout?.on("error", () => finish(blocked(4, "environment")));
    child.stderr?.on("error", () => finish(blocked(4, "environment")));
    const abort = (): void => finish(blocked(3, "cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    child.once("spawn", () => {
      try {
        if (child.pid) onPid(child.pid);
      } catch {
        finish(blocked(5, "artifact"));
      }
      if (signal.aborted) abort();
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (data: string) => {
      if (!outputTruncated) stdout += data;
      ready ||= Boolean(readyText && stdout.includes(readyText));
      if (stdout.length + stderr.length > 65_536) {
        outputTruncated = true;
        stdout = "";
        stderr = "";
      }
      if (ready) finish(ok());
    });
    child.stderr.on("data", (data: string) => {
      if (!outputTruncated) stderr += data;
      if (stdout.length + stderr.length > 65_536) {
        outputTruncated = true;
        stdout = "";
        stderr = "";
      }
    });
    child.once("error", () => finish(blocked(4, "environment")));
    child.once("close", (code) =>
      finish({
        ...(readyText ? { status: "failed" as const, exitCode: 1, category: "assertion" as const } : ok()),
        processExit: code,
      }),
    );
  });
}

export async function executeCheck(
  check: ProjectCheck,
  input: {
    root: string;
    cwd: string;
    workspace: ExecutionWorkspace;
    signal: AbortSignal;
    onPid: (pid: number) => void;
    runAgent: (
      config: string,
      signal: AbortSignal,
      env: NodeJS.ProcessEnv,
      onPid: (pid: number) => void,
    ) => Promise<CheckOutcome>;
  },
): Promise<CheckOutcome> {
  const { signal } = input;
  if (signal.aborted) return blocked(3, "cancelled");
  if (check.type === "resources") {
    const disk = statfsSync(input.root);
    const observations = { freeMemoryMb: Math.floor(freemem() / 1048576), freeDiskMb: Math.floor(disk.bavail * disk.bsize / 1048576) };
    return { ...(observations.freeMemoryMb >= (check.minFreeMemoryMb ?? 0) && observations.freeDiskMb >= (check.minFreeDiskMb ?? 0) ? ok() : { status: "failed" as const, exitCode: 1, category: "assertion" as const }), observations };
  }
  if (check.type === "agent")
    return input.runAgent(
      projectPath(input.root, check.config),
      signal,
      checkEnvironment(check, input.workspace),
      input.onPid,
    );
  if (check.type === "http") {
    if (!check.allowOutbound) return blocked(6, "policy");
    const url = new URL(check.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return blocked(6, "policy");
    try {
      const response = await fetch(url, { signal, redirect: "manual" });
      await response.body?.cancel();
      return response.status === check.expectedStatus
        ? { ...ok(), httpStatus: response.status }
        : { status: "failed", exitCode: 1, category: "assertion", httpStatus: response.status };
    } catch {
      return signal.aborted ? blocked(3, "cancelled") : blocked(4, "environment");
    }
  }
  if (check.type === "filesystem") {
    const file = projectPath(input.root, resolve(input.cwd, check.path));
    const exists = existsSync(file);
    let passed =
      check.expectation === "absent"
        ? !exists
        : exists && (check.expectation === "file" ? lstatSync(file).isFile() : lstatSync(file).isDirectory());
    if (passed && check.sha256) {
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(file, { signal })) hash.update(chunk);
      passed = hash.digest("hex") === check.sha256;
    }
    return passed ? ok() : { status: "failed", exitCode: 1, category: "assertion" };
  }
  const command = check.type === "docker" ? "docker" : check.command;
  const args = check.type === "docker" ? ["inspect", "--format", "{{.State.Status}}", check.container] : check.args;
  const result = await runCheckProcess(
    command,
    args,
    input.cwd,
    checkEnvironment(check, input.workspace),
    signal,
    input.onPid,
    check.type === "process" ? check.readyText : undefined,
  );
  if (result.exitCode !== 0 || check.type === "process") return result;
  if (check.type === "docker") {
    return assessDockerState(result, check.expectedState);
  }
  return result.processExit === check.expectedExit
    ? result
    : { ...result, status: "failed", exitCode: 1, category: "assertion" };
}
export const monotonicNow = (): number => performance.now();

export function assessDockerState(result: CheckOutcome, expectedState: "running" | "exited"): CheckOutcome {
  if (result.exitCode !== 0) return result;
  if (result.processExit !== 0) return { ...result, ...blocked(4, "environment") };
  return result.stdout?.trim() === expectedState
    ? result
    : { ...result, status: "failed", exitCode: 1, category: "assertion" };
}
