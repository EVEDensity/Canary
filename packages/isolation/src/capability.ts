import { spawnSync } from "node:child_process";

export type IsolationMode = "none" | "userspace" | "os";
export type IsolationPurpose = "trusted_eval" | "untrusted_candidate" | "auto_hard_write";

export interface IsolationCapability {
  userspace: true;
  os: boolean;
  osKind?: "docker" | "bwrap";
  platform: NodeJS.Platform;
  notes: string[];
}

export function probeIsolation(): IsolationCapability {
  const notes: string[] = [
    "userspace preload is not an OS security boundary",
    "Node child_process without preload is not a sandbox",
    "worktrees and MCP prompts are not sandboxes",
  ];
  const docker = spawnSync("docker", ["--version"], { encoding: "utf8", timeout: 3000, windowsHide: true });
  if (docker.status === 0) {
    return { userspace: true, os: true, osKind: "docker", platform: process.platform, notes };
  }
  if (process.platform === "linux") {
    const bwrap = spawnSync("bwrap", ["--version"], { encoding: "utf8", timeout: 3000 });
    if (bwrap.status === 0) return { userspace: true, os: true, osKind: "bwrap", platform: process.platform, notes };
  }
  notes.push("OS isolation (docker/bwrap) was not detected; auto hard write requiring OS isolation must fail closed");
  return { userspace: true, os: false, platform: process.platform, notes };
}

export function requiredMode(purpose: IsolationPurpose, osRequiredForAutoHard = true): IsolationMode {
  if (purpose === "trusted_eval") return "none";
  if (purpose === "auto_hard_write" && osRequiredForAutoHard) return "os";
  return "userspace";
}

export interface ProcessBoundary {
  insideSandbox: string[];
  outsideSandbox: string[];
  notASandbox: string[];
}

export const PROCESS_BOUNDARY: ProcessBoundary = {
  insideSandbox: ["isolated candidate worker", "candidate-started tools", "candidate HTTP/MCP calls"],
  outsideSandbox: ["CLI", "policy engine", "authorization/budget ledger", "isolation supervisor", "evaluators", "trusted applyer", "loop controller"],
  notASandbox: ["git worktree", "unrestricted Node child_process", "MCP permission prompt", "MemoryStateStore.restore"],
};
