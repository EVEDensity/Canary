import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { AuthorizationRecord } from "@canary/core";
import { PathGuard, PolicyDenied, PolicyStore, contentHash, createAuthorization, defaultPolicy, isAuthorizationLive, type EvolutionPolicyDocument } from "@canary/policy";

export type CandidateStatus = "prepared" | "verified" | "rejected" | "queued" | "applied" | "discarded" | "revoked";

export interface FileChange {
  path: string;
  beforeHash?: string;
  afterHash: string;
  diff: string;
  kind: "modify" | "add";
}

export interface CandidateManifest {
  v: 1;
  id: string;
  projectRoot: string;
  workspace: string;
  authorizationId: string;
  policyVersion: string;
  baselineHash: string;
  identity: AuthorizationRecord["projectIdentity"];
  allowedPaths: string[];
  files: FileChange[];
  contentHash: string;
  createdAt: string;
  status: CandidateStatus;
  verification?: CandidateVerification;
  queueError?: string;
}

export interface CandidateVerification {
  valid: boolean;
  comparable: boolean;
  verdict?: string;
  admission?: string;
  reasons: string[];
  independent: true;
  candidateReportIgnored: true;
}

const BUILD_FILES = new Set(["package.json", "pnpm-lock.yaml", "package-lock.json", "yarn.lock", "pnpm-workspace.yaml"]);

function walkFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist" || name === ".canary") continue;
      walkFiles(full, acc);
    } else acc.push(full);
  }
  return acc;
}

function fileHash(file: string): string | undefined {
  if (!existsSync(file)) return undefined;
  return contentHash(readFileSync(file));
}

function unifiedDiff(pathName: string, before: string | undefined, after: string): string {
  return `--- a/${pathName}\n+++ b/${pathName}\n@@\n${before ?? ""}\n---\n${after}\n`;
}

function matchesAllow(rel: string, allow: string[]): boolean {
  const normalized = rel.replace(/\\/g, "/");
  return allow.some((pattern) => {
    const p = pattern.replace(/\\/g, "/").replace(/\/$/, "");
    return normalized === p || normalized.startsWith(p + "/") || p === "*" || p === "**";
  });
}

export function projectBaselineHash(projectRoot: string): string {
  const hash = createHash("sha256");
  for (const file of walkFiles(projectRoot).sort()) {
    hash.update(relative(projectRoot, file).replace(/\\/g, "/"));
    hash.update(readFileSync(file));
  }
  return hash.digest("hex");
}

export class CandidateWorkspace {
  readonly projectRoot: string;
  readonly root: string;
  constructor(projectRoot: string) {
    this.projectRoot = resolve(projectRoot);
    this.root = resolve(this.projectRoot, ".canary", "candidates");
    mkdirSync(this.root, { recursive: true });
  }

  pathFor(id: string): string { return resolve(this.root, id); }
  manifestPath(id: string): string { return resolve(this.root, id, "manifest.json"); }

  read(id: string): CandidateManifest {
    return JSON.parse(readFileSync(this.manifestPath(id), "utf8")) as CandidateManifest;
  }

  save(manifest: CandidateManifest): CandidateManifest {
    mkdirSync(dirname(this.manifestPath(manifest.id)), { recursive: true });
    writeFileSync(this.manifestPath(manifest.id), JSON.stringify(manifest, null, 2), "utf8");
    return manifest;
  }

  prepare(input: {
    id: string;
    authorization: AuthorizationRecord;
    policy: EvolutionPolicyDocument;
    files: Array<{ path: string; content: string }>;
    baselineHash: string;
  }): CandidateManifest {
    const live = isAuthorizationLive(input.authorization);
    if (!live.ok) throw new PolicyDenied("POL-06", live.reason);
    if (input.authorization.mode !== "hard") throw new PolicyDenied("POL-05", "soft authorization cannot create a source candidate");
    if (!["owned", "fork", "authorized_copy"].includes(input.authorization.projectIdentity.kind)) {
      throw new PolicyDenied("POL-06", "open-source labels are not write authorization");
    }
    const workspace = this.pathFor(input.id);
    mkdirSync(join(workspace, "tree"), { recursive: true });
    const guard = new PathGuard({
      workspace: this.projectRoot,
      protect: input.policy.protect.map((item) => resolve(this.projectRoot, item)),
    });
    const files: FileChange[] = [];
    for (const file of input.files) {
      const rel = file.path.replace(/\\/g, "/").replace(/^\.\//, "");
      if (BUILD_FILES.has(rel.split("/").pop() ?? rel)) {
        throw new PolicyDenied("POL-01", `dependency/build manifest changes require a dedicated policy: ${rel}`);
      }
      if (!matchesAllow(rel, input.authorization.allow.paths) || !matchesAllow(rel, input.policy.allowPaths)) {
        throw new PolicyDenied("POL-05", `file is outside the authorized change surface: ${rel}`);
      }
      guard.assertAllowed(resolve(this.projectRoot, rel), "write");
      const before = existsSync(resolve(this.projectRoot, rel)) ? readFileSync(resolve(this.projectRoot, rel), "utf8") : undefined;
      const dest = resolve(workspace, "tree", rel);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, file.content, "utf8");
      files.push({
        path: rel,
        beforeHash: before !== undefined ? contentHash(before) : undefined,
        afterHash: contentHash(file.content),
        diff: unifiedDiff(rel, before, file.content),
        kind: before === undefined ? "add" : "modify",
      });
    }
    const manifest: CandidateManifest = {
      v: 1,
      id: input.id,
      projectRoot: this.projectRoot,
      workspace,
      authorizationId: input.authorization.id,
      policyVersion: input.policy.version,
      baselineHash: input.baselineHash,
      identity: input.authorization.projectIdentity,
      allowedPaths: input.authorization.allow.paths,
      files,
      contentHash: contentHash(files.map((item) => item.path + item.afterHash).join("|")),
      createdAt: new Date().toISOString(),
      status: "prepared",
    };
    return this.save(manifest);
  }

  discard(id: string): void {
    const manifest = this.read(id);
    manifest.status = "discarded";
    this.save(manifest);
    rmSync(join(manifest.workspace, "tree"), { recursive: true, force: true });
  }
}

export function rejectForgedReport(report: Record<string, unknown>): never {
  throw new PolicyDenied("POL-06", `candidate report cannot approve itself: ${JSON.stringify(report)}`);
}

export function ensurePolicyStore(projectRoot: string): { policy: EvolutionPolicyDocument; store: PolicyStore } {
  const store = new PolicyStore(projectRoot);
  return { store, policy: store.loadOrCreate(projectRoot) };
}

export { createAuthorization, defaultPolicy };
