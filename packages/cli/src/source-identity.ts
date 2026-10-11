import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RunSnapshot } from "@canary/core";
import { stableHash } from "@canary/trace";
import { projectSourceInventory } from "./discovery.js";
import { isInsideRoot } from "./home.js";

export interface SourceFingerprint {
  commit: string;
  indexHash: string;
  trackedStatusHash: string;
  sourceHash: string;
  trackedFilesHash: string;
}
export interface ExecutionSourceProof {
  v: 1;
  kind: "canary.execution-source";
  runId: string;
  status: "unchanged" | "changed" | "unavailable";
  projectPath?: string;
  before?: SourceFingerprint;
  after?: SourceFingerprint;
}
const fingerprintFields = ["commit", "indexHash", "trackedStatusHash", "sourceHash", "trackedFilesHash"] as const;
const digest = /^[a-f0-9]{64}$/;
const commitId = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function validFingerprint(value: unknown): value is SourceFingerprint {
  return object(value) && Object.keys(value).length === fingerprintFields.length && fingerprintFields.every((field) => typeof value[field] === "string" && (field === "commit" ? commitId : digest).test(value[field] as string));
}
function git(cwd: string, args: string[], trim = true): string {
  const runtime = ["PATH", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT"];
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => runtime.some((allowed) => allowed.toLowerCase() === name.toLowerCase()))),
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0",
  };
  const output = execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], { cwd, env, encoding: "utf8", windowsHide: true, timeout: 10_000, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  return trim ? output.trim() : output;
}

/** Git state covers the whole repository; source inventory keeps the run's project scope. */
export function sourceFingerprint(checkout: string, sourceRoot = checkout): SourceFingerprint {
  const repository = git(checkout, ["rev-parse", "--show-toplevel"]);
  const commit = git(repository, ["rev-parse", "HEAD"]);
  return {
    commit,
    indexHash: stableHash(git(repository, ["ls-files", "--stage", "-z"], false)),
    trackedStatusHash: stableHash(git(repository, ["status", "--porcelain", "-z", "--untracked-files=no"], false)),
    sourceHash: stableHash(projectSourceInventory(sourceRoot)),
    trackedFilesHash: stableHash(trackedBytes(repository, commit)),
  };
}
export function trySourceFingerprint(project: string): SourceFingerprint | undefined {
  try { return sourceFingerprint(project, project); } catch { return undefined; }
}
export function executionSourceProof(run: Pick<RunSnapshot, "runId" | "evidence">, before: SourceFingerprint | undefined, after: SourceFingerprint | undefined): ExecutionSourceProof {
  const recorded = run.evidence?.reproduction;
  const status = !before || !after ? "unavailable" :
    before.commit === recorded?.gitCommit && before.sourceHash === recorded.sourceHash && stableHash(before) === stableHash(after) ? "unchanged" : "changed";
  return { v: 1, kind: "canary.execution-source", runId: run.runId, status, projectPath: recorded?.projectPath, before, after };
}
/** Artifact sealing alone does not establish execution against unchanged source. */
export function executionSourceReasons(value: unknown, run: Pick<RunSnapshot, "runId" | "evidence">, label: string): string[] {
  const message = `${label} execution source proof`;
  if (!object(value) || value.v !== 1 || value.kind !== "canary.execution-source" || value.runId !== run.runId || Object.keys(value).some((key) => !["v", "kind", "runId", "status", "projectPath", "before", "after"].includes(key))) return [`${message} is missing or invalid`];
  if (value.status === "changed") return [`${message} changed during checks`];
  const before = value.before, after = value.after;
  if (value.status !== "unchanged" || !validFingerprint(before) || !validFingerprint(after)) return [`${message} is unavailable or incomplete`];
  const recorded = run.evidence?.reproduction;
  if (!recorded?.gitCommit || value.projectPath !== recorded.projectPath || before.commit !== recorded.gitCommit || after.commit !== recorded.gitCommit || before.sourceHash !== recorded.sourceHash) return [`${message} does not match the sealed run source identity`];
  if (!fingerprintFields.every((field) => before[field] === after[field])) return [`${message} changed during checks`];
  return [];
}

/** Hash every tracked blob, including fixtures outside recognized source extensions. */
function trackedBytes(checkout: string, commit: string) {
  const algorithm = git(checkout, ["rev-parse", "--show-object-format"]);
  if (!["sha1", "sha256"].includes(algorithm)) throw new Error("Unknown Git object format");
  const rows = git(checkout, ["ls-tree", "-r", "-z", commit], false).split("\0").filter(Boolean);
  const crlfText = new Set(git(checkout, ["ls-files", "--eol", "-z"], false).split("\0").flatMap((row) => {
    const match = row.match(/^i\/lf\s+w\/crlf\s+attr\/([^\t]*)\t([\s\S]+)$/);
    return match && !match[1]!.includes("-text") ? [match[2]!] : [];
  }));
  if (rows.length > 10_000) throw new Error("Tracked input budget exceeded");
  let size = 0;
  return rows.map((row) => {
    const match = row.match(/^(\d+) blob ([a-f0-9]+)\t([\s\S]+)$/);
    if (!match) throw new Error("Only ordinary tracked files can establish repair source identity");
    const [, mode, expected, path] = match, file = join(checkout, path!);
    if (!isInsideRoot(file, checkout)) throw new Error("Unsafe tracked input");
    const stat = lstatSync(file);
    if (!stat.isFile()) throw new Error("Unsafe tracked input");
    size += stat.size;
    if (stat.size > 16_777_216 || size > 268_435_456) throw new Error("Tracked input budget exceeded");
    const bytes = readFileSync(file);
    if (bytes.length !== stat.size) throw new Error("Tracked input changed while its identity was read");
    const observed = createHash(algorithm).update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    const canonicalBytes = crlfText.has(path!) ? Buffer.from(bytes.toString("utf8").replaceAll("\r\n", "\n")) : bytes;
    const canonical = createHash(algorithm).update(`blob ${canonicalBytes.length}\0`).update(canonicalBytes).digest("hex");
    return { path, mode, expected, observed, canonical };
  });
}
export function baselineMatches(checkout: string, commit: string): boolean {
  if (git(checkout, ["rev-parse", "HEAD"]) !== commit) return false;
  const tracked = trackedBytes(checkout, commit);
  const index = new Map(git(checkout, ["ls-files", "--stage", "-z"], false).split("\0").filter(Boolean).map((row) => {
    const match = row.match(/^(\d+) ([a-f0-9]+) 0\t([\s\S]+)$/);
    if (!match) throw new Error("Baseline index contains unresolved stages");
    return [match[3]!, { mode: match[1], hash: match[2] }] as const;
  }));
  if (index.size !== tracked.length || tracked.some((file) => index.get(file.path!)?.hash !== file.expected || index.get(file.path!)?.mode !== file.mode)) throw new Error("Baseline index differs from the retained commit");
  const mismatch = tracked.find((file) => file.expected !== file.canonical);
  if (mismatch) throw new Error("Baseline tracked bytes differ from Git: " + mismatch.path);
  return true;
}
