import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { PathGuard, PolicyDenied, collectInodes, type EvolutionPolicyDocument, isolationMissing } from "@canary/policy";
import { probeIsolation, requiredMode, type IsolationPurpose } from "./capability.js";
import { buildIsolatedEnv } from "./env.js";
import { createIsolationPreload } from "./preload-source.js";
import { killProcessTree } from "./process.js";

export interface IsolationRequest {
  purpose: IsolationPurpose;
  workspace: string;
  policy: EvolutionPolicyDocument;
  envAllowlist?: string[];
  extraEnv?: Record<string, string | undefined>;
}

export function assertIsolationReady(request: IsolationRequest): ReturnType<typeof probeIsolation> {
  const cap = probeIsolation();
  const mode = requiredMode(request.purpose, request.policy.isolation.osRequiredForAutoHard);
  if (mode === "os" && !cap.os) {
    isolationMissing(request.policy, cap.os, "auto_hard_write");
  }
  if (request.purpose !== "trusted_eval" && request.policy.isolation.mode === "none") {
    throw new PolicyDenied("POL-03", "isolation disabled; only trusted manual suggestions remain");
  }
  if (request.purpose !== "trusted_eval" && !cap.userspace) {
    throw new PolicyDenied("POL-03", "isolation capability missing; fail closed");
  }
  return cap;
}

export function writePreload(dir = tmpdir()): string {
  const file = join(dir, `canary-isolation-preload-${process.pid}-${randomUUID()}.cjs`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, createIsolationPreload(), "utf8");
  return file;
}

export interface IsolatedRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  denials: Array<{ code?: string; message?: string }>;
}

export async function runIsolatedScript(request: IsolationRequest, source: string, timeoutMs = 8_000): Promise<IsolatedRunResult> {
  const cap = assertIsolationReady(request);
  if (request.purpose === "trusted_eval") {
    throw new PolicyDenied("POL-03", "trusted_eval must not use the isolated candidate executor");
  }
  const workspace = resolve(request.workspace);
  const protectAbs = request.policy.protect.map((item) => resolve(workspace, item));
  const denialLog = join(workspace, ".canary-isolation-denials.jsonl");
  const preload = writePreload(workspace);
  const script = join(workspace, `.canary-isolated-${Date.now()}.cjs`);
  writeFileSync(script, source, "utf8");
  const isolation = {
    workspace,
    protect: protectAbs,
    protectInodes: [...collectInodes(protectAbs)],
    allowHosts: request.policy.networkAllowHosts,
    denialLog,
  };
  const env = buildIsolatedEnv(request.envAllowlist ?? request.policy.envAllowlist, {
    ...request.extraEnv,
    CANARY_ISOLATION: JSON.stringify(isolation),
    CANARY_ISOLATION_MODE: cap.os ? "os-available-userspace-enforced" : "userspace",
  });
  const child = spawn(process.execPath, ["--require", preload, script], {
    cwd: workspace,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr?.on("data", (chunk: string) => { stderr += chunk; });
  const exitCode = await new Promise<number | null>((resolvePromise) => {
    const timer = setTimeout(() => {
      if (child.pid) killProcessTree(child.pid);
      else child.kill("SIGKILL");
      resolvePromise(null);
    }, timeoutMs);
    child.once("close", (code) => { clearTimeout(timer); resolvePromise(code); });
  });
  const denials = readDenials(denialLog);
  return { exitCode, stdout, stderr, denials };
}

function readDenials(file: string): Array<{ code?: string; message?: string }> {
  try {
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { code?: string; message?: string });
  } catch {
    return [];
  }
}

export function isolationGuard(request: IsolationRequest): PathGuard {
  const workspace = resolve(request.workspace);
  return new PathGuard({
    workspace,
    protect: request.policy.protect.map((item) => resolve(workspace, item)),
    protectedInodes: collectInodes(request.policy.protect.map((item) => resolve(workspace, item))),
  });
}

export function spawnIsolatedNode(request: IsolationRequest, args: string[], stdio: ("ignore" | "pipe" | "ipc")[] = ["ignore", "ignore", "pipe", "ipc"]): ChildProcess {
  assertIsolationReady(request);
  const workspace = resolve(request.workspace);
  const protectAbs = request.policy.protect.map((item) => resolve(workspace, item));
  const preloadDir = request.extraEnv?.CANARY_TMPDIR || workspace;
  const preload = writePreload(preloadDir);
  const env = buildIsolatedEnv(request.envAllowlist ?? request.policy.envAllowlist, {
    ...request.extraEnv,
    CANARY_ISOLATION: JSON.stringify({
      workspace,
      protect: protectAbs,
      protectInodes: [...collectInodes(protectAbs)],
      allowHosts: request.policy.networkAllowHosts,
    }),
  });
  return spawn(process.execPath, ["--require", preload, ...args], {
    cwd: workspace,
    env,
    windowsHide: true,
    stdio,
    detached: process.platform !== "win32",
  });
}
