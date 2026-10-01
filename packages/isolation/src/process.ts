import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Windows / POSIX process-tree adapter. Not an OS sandbox. */
export const PROCESS_ADAPTER = {
  platform: process.platform,
  isWindows: process.platform === "win32",
  usesProcessGroups: process.platform !== "win32",
  terminateSignal: "SIGTERM" as const,
  killSignal: "SIGKILL" as const,
};

export function pidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    if (process.platform === "linux") {
      try {
        // kill(pid, 0) also succeeds for zombies awaiting reaping by their parent.
        // The command field can contain spaces and parentheses; state follows its final ')'.
        const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
        const state = stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3);
        if (state === "Z" || state === "X") return false;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        // Restricted /proc access falls back to the successful signal probe.
      }
    }
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM") return true;
    return false;
  }
}

export function killProcessTree(pid: number, signal: NodeJS.Signals = PROCESS_ADAPTER.killSignal): void {
  if (!pid) return;
  if (PROCESS_ADAPTER.isWindows) {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      /* already exited */
    }
  }
}

export async function waitForExit(pid: number, timeoutMs = 4_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!pidAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return !pidAlive(pid);
}

export async function reclaimOrphans(pids: readonly number[], graceMs = 200): Promise<number[]> {
  const remaining: number[] = [];
  for (const pid of pids) {
    if (!pidAlive(pid)) continue;
    killProcessTree(pid, PROCESS_ADAPTER.terminateSignal);
  }
  if (graceMs > 0) await new Promise((resolve) => setTimeout(resolve, graceMs));
  for (const pid of pids) {
    if (!pidAlive(pid)) continue;
    killProcessTree(pid, PROCESS_ADAPTER.killSignal);
    if (pidAlive(pid)) remaining.push(pid);
  }
  return remaining;
}
