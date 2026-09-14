import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AuthorizationRecord } from "@canary/core";
import { PolicyDenied } from "./paths.js";

export const POLICY_SCHEMA_VERSION = 1 as const;

export interface EvolutionPolicyDocument {
  v: typeof POLICY_SCHEMA_VERSION;
  version: string;
  projectRoot: string;
  isolation: { mode: "none" | "userspace" | "os"; osRequiredForAutoHard: boolean };
  protect: string[];
  allowPaths: string[];
  envAllowlist: string[];
  networkAllowHosts: string[];
  toolAllow: string[];
  createdAt: string;
}

export const DEFAULT_PROTECT = [
  ".canary/policy",
  ".canary/control-plane",
  ".canary/loop",
  ".canary/apply",
  "canary.config.ts",
  "canary.config.js",
  "cases",
  "package.json",
  "pnpm-lock.yaml",
];

export const DEFAULT_ENV_ALLOWLIST = [
  "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP",
  "HOME", "USERPROFILE", "LANG", "LC_ALL", "TZ", "SystemDrive",
  "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS", "ProgramFiles", "ProgramW6432",
];

export function defaultPolicy(projectRoot: string): EvolutionPolicyDocument {
  return {
    v: 1,
    version: "pol_1",
    projectRoot: resolve(projectRoot),
    isolation: { mode: "userspace", osRequiredForAutoHard: true },
    protect: [...DEFAULT_PROTECT],
    allowPaths: ["src", "agent.ts", "agent.js", "agent.mjs"],
    envAllowlist: [...DEFAULT_ENV_ALLOWLIST],
    networkAllowHosts: [],
    toolAllow: [],
    createdAt: new Date().toISOString(),
  };
}

export function policyDir(projectRoot: string): string {
  return resolve(projectRoot, ".canary", "policy");
}

function atomicWrite(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  writeFileSync(file, readFileSync(tmp, "utf8"), "utf8");
  try { unlinkSync(tmp); } catch { /* ignore */ }
}

function readJson<T>(file: string): T | undefined {
  try { return JSON.parse(readFileSync(file, "utf8")) as T; } catch { return undefined; }
}

export class PolicyStore {
  readonly root: string;
  constructor(projectRoot: string) {
    this.root = policyDir(projectRoot);
    mkdirSync(this.root, { recursive: true });
  }

  policyPath(): string { return resolve(this.root, "policy.json"); }

  load(): EvolutionPolicyDocument | undefined {
    return readJson<EvolutionPolicyDocument>(this.policyPath());
  }

  save(policy: EvolutionPolicyDocument): EvolutionPolicyDocument {
    atomicWrite(this.policyPath(), policy);
    return policy;
  }

  loadOrCreate(projectRoot: string): EvolutionPolicyDocument {
    return this.load() ?? this.save(defaultPolicy(projectRoot));
  }
}

export class AuthorizationStore {
  readonly root: string;
  constructor(projectRoot: string) {
    this.root = resolve(policyDir(projectRoot), "authorizations");
    mkdirSync(this.root, { recursive: true });
  }

  pathFor(id: string): string { return resolve(this.root, `${id}.json`); }

  save(record: AuthorizationRecord): AuthorizationRecord {
    if (!record.wired) throw new PolicyDenied("POL-06", "authorization.wired must be true");
    atomicWrite(this.pathFor(record.id), record);
    return record;
  }

  get(id: string): AuthorizationRecord | undefined {
    return readJson<AuthorizationRecord>(this.pathFor(id));
  }

  revoke(id: string, revokeId: string): AuthorizationRecord {
    const current = this.get(id);
    if (!current) throw new PolicyDenied("POL-06", `unknown authorization: ${id}`);
    const next: AuthorizationRecord = { ...current, revoked: true, revokeId };
    return this.save(next);
  }
}

export function isAuthorizationLive(record: AuthorizationRecord, now = new Date()): { ok: true } | { ok: false; reason: string } {
  if (record.revoked) return { ok: false, reason: `authorization revoked (${record.revokeId ?? record.id})` };
  if (record.expiresAt && Date.parse(record.expiresAt) <= now.getTime()) return { ok: false, reason: "authorization expired" };
  if (!record.projectIdentity?.kind) return { ok: false, reason: "project identity missing" };
  if (record.projectIdentity.kind === undefined) return { ok: false, reason: "open-source labels are not write authorization" };
  return { ok: true };
}

export function createAuthorization(input: Omit<AuthorizationRecord, "v" | "wired">): AuthorizationRecord {
  return { v: 1, wired: true, ...input };
}

export class ApprovalStore {
  readonly root: string;
  constructor(projectRoot: string) {
    this.root = resolve(policyDir(projectRoot), "approvals");
    mkdirSync(this.root, { recursive: true });
  }

  save(id: string, value: { id: string; actor: string; reason: string; approvedHash: string; at: string; authorizationId: string }): void {
    atomicWrite(resolve(this.root, `${id}.json`), value);
  }

  get(id: string): { id: string; actor: string; reason: string; approvedHash: string; at: string; authorizationId: string } | undefined {
    return readJson(resolve(this.root, `${id}.json`));
  }
}

export function assertNotCandidateWritable(projectRoot: string, file: string): void {
  const policyRoot = policyDir(projectRoot);
  const resolved = resolve(file);
  if (resolved.toLowerCase().startsWith(policyRoot.toLowerCase())) return;
  if (!existsSync(file)) return;
}
