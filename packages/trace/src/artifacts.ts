import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { artifactManifestSchema, type ArtifactManifest, type RunLineage } from "@canary/core";
import {
  containsSensitiveText,
  containsSensitiveValue,
  redactText,
  redactValue,
  type RedactionOptions,
} from "./privacy.js";

export type IntegrityStatus = "verified" | "legacy" | "partial" | "invalid" | "missing";
export interface IntegrityResult {
  v: 1;
  kind: "canary.artifact-integrity";
  runId: string;
  status: IntegrityStatus;
  manifestHash?: string;
  revision?: number;
  issues: Array<{ code: string; path: string }>;
}
export class ArtifactIntegrityError extends Error {
  readonly code = "ARTIFACT_INTEGRITY";
  constructor(readonly result: IntegrityResult) {
    super(`Artifact integrity check failed (${result.status}). Run canary verify <runId> --json for file diagnostics.`);
  }
}
export class ArtifactPrivacyError extends Error {
  readonly code = "ARTIFACT_PRIVACY";
  constructor() {
    super("Artifact privacy scan failed; sensitive content was not finalized.");
  }
}
export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
export function stableHash(value: unknown): string {
  const stable = (item: unknown): unknown => {
    if (typeof item === "function") return { function: String(item) };
    if (Array.isArray(item)) return item.map(stable);
    if (item && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, val]) => [key, stable(val)]),
      );
    return item;
  };
  return sha256(JSON.stringify(stable(value)) ?? "null");
}
export function safeArtifactPath(root: string, name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name) || name === "." || name === "..")
    throw new Error("Invalid artifact identifier");
  const target = join(resolve(root), name);
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) throw new Error("Artifact symlinks are not supported");
  return target;
}
/** Durable bytes first, atomic rename second. A failed replacement leaves the previous file intact. */
export function atomicWrite(file: string, body: string): void {
  if (existsSync(file) && lstatSync(file).isSymbolicLink()) throw new Error("Artifact symlinks are not supported");
  const temporary = `${file}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, "wx");
  try {
    writeFileSync(fd, body, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(temporary, file);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
export function writePrivateJson(file: string, value: unknown, options: RedactionOptions = {}): void {
  atomicWrite(file, JSON.stringify(redactValue(value, options), null, 2));
}
export function writePrivateText(file: string, value: string, options: RedactionOptions = {}): void {
  atomicWrite(file, redactText(value, options));
}

export function readArtifactManifest(dir: string): ArtifactManifest | undefined {
  const file = safeArtifactPath(dir, "manifest.json");
  if (!existsSync(file)) return undefined;
  return artifactManifestSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}
const transient = new Set(["run.lock", "manifest.lock", "tmp", "work", "manifest-history"]);
function inventory(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name !== "manifest.json" && !transient.has(name))
    .sort();
}
function checkBody(name: string, body: string): boolean {
  try {
    if (name.endsWith(".json")) JSON.parse(body);
    if (name.endsWith(".jsonl")) for (const line of body.split(/\r?\n/)) if (line.trim()) JSON.parse(line);
    return true;
  } catch {
    return false;
  }
}

export function verifyArtifacts(dir: string, ancestors: ReadonlySet<string> = new Set()): IntegrityResult {
  const result: IntegrityResult = {
    v: 1,
    kind: "canary.artifact-integrity",
    runId: basename(dir),
    status: "missing",
    issues: [],
  };
  if (!existsSync(dir)) return result;
  const identity = resolve(dir);
  if (ancestors.has(identity) || ancestors.size >= 16) return { ...result, status: "invalid", issues: [{ code: "EVIDENCE_REFERENCE_CYCLE", path: "run.json" }] };
  const visited = new Set([...ancestors, identity]);
  if (lstatSync(dir).isSymbolicLink())
    return { ...result, status: "invalid", issues: [{ code: "UNSAFE_PATH", path: "." }] };
  let manifest: ArtifactManifest | undefined;
  try {
    manifest = readArtifactManifest(dir);
  } catch {
    return { ...result, status: "invalid", issues: [{ code: "MANIFEST_INVALID", path: "manifest.json" }] };
  }
  if (!manifest) {
    if (!existsSync(join(dir, "run.json"))) return result;
    // R3 runs carry a marker in run.json, so deleting a manifest cannot silently downgrade them to legacy.
    try {
      const run = JSON.parse(readFileSync(safeArtifactPath(dir, "run.json"), "utf8"));
      return run.evidence?.v === 1
        ? { ...result, status: "invalid", issues: [{ code: "MANIFEST_MISSING", path: "manifest.json" }] }
        : { ...result, status: "legacy" };
    } catch {
      return { ...result, status: "invalid", issues: [{ code: "RUN_INVALID", path: "run.json" }] };
    }
  }
  result.manifestHash = sha256(readFileSync(join(dir, "manifest.json")));
  result.revision = manifest.revision;
  const issue = (code: string, path: string): void => {
    result.issues.push({ code, path: redactText(path) });
  };
  if (manifest.runId !== basename(dir)) issue("RUN_ID_MISMATCH", "manifest.json");
  const seen = new Set<string>();
  for (const file of manifest.files) {
    if (seen.has(file.path) || transient.has(file.path) || file.path === "manifest.json")
      issue("MANIFEST_FILE_INVALID", file.path);
    seen.add(file.path);
  }
  // Follow content-addressed previous manifests; history is never silently recreated by readers.
  let previous = manifest.previousManifestHash;
  let revision = manifest.revision;
  const historyNames = new Set<string>();
  while (previous && revision > 1) {
    try {
      const historyDir = safeArtifactPath(dir, "manifest-history");
      historyNames.add(`${previous}.json`);
      const bytes = readFileSync(safeArtifactPath(historyDir, `${previous}.json`));
      const parent = artifactManifestSchema.parse(JSON.parse(bytes.toString("utf8")));
      if (sha256(bytes) !== previous || parent.runId !== manifest.runId || parent.revision !== revision - 1)
        throw new Error("history mismatch");
      previous = parent.previousManifestHash;
      revision = parent.revision;
    } catch {
      issue("HISTORY_INVALID", "manifest-history");
      break;
    }
  }
  if ((revision !== 1 || previous) && !result.issues.some((item) => item.code === "HISTORY_INVALID"))
    issue("HISTORY_INVALID", "manifest-history");
  try {
    const historyDir = safeArtifactPath(dir, "manifest-history");
    if (existsSync(historyDir))
      for (const name of readdirSync(historyDir))
        if (!historyNames.has(name)) issue("UNLISTED_HISTORY", "manifest-history");
  } catch {
    issue("HISTORY_INVALID", "manifest-history");
  }
  if (manifest.state === "partial") return { ...result, status: result.issues.length ? "invalid" : "partial" };
  if (!manifest.privacy.scanned) issue("PRIVACY_UNSCANNED", "manifest.json");
  for (const name of ["tmp", "work"]) if (existsSync(join(dir, name))) issue("EPHEMERAL_DATA_RETAINED", name);
  for (const name of inventory(dir)) if (!seen.has(name)) issue("UNLISTED_FILE", name);
  for (const file of manifest.files) {
    try {
      const target = safeArtifactPath(dir, file.path);
      const bytes = readFileSync(target);
      if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) issue("HASH_MISMATCH", file.path);
      if (!checkBody(file.path, bytes.toString("utf8"))) issue("CONTENT_INVALID", file.path);
      if (file.path === "run.json") {
        const run = JSON.parse(bytes.toString("utf8"));
        if (
          run.runId !== manifest.runId ||
          (run.evidence && stableHash(run.evidence.lineage) !== stableHash(manifest.lineage))
        )
          issue("LINEAGE_MISMATCH", file.path);
        // Project agent checks pin a completed run in the same artifact collection.
        if (Array.isArray(run.checks)) for (const check of run.checks) {
          if (!check.childRun) continue;
          try {
            const childDir = safeArtifactPath(resolve(dir, ".."), check.childRun.runId);
            const child = verifyArtifacts(childDir, visited);
            if (child.status !== "verified" || child.manifestHash !== check.childRun.manifestHash || resolve(check.childRun.artifactPath) !== join(childDir, "run.json")) issue("CHILD_EVIDENCE_INVALID", "run.json");
          } catch { issue("CHILD_EVIDENCE_INVALID", "run.json"); }
        }
      }
    } catch {
      issue("FILE_MISSING_OR_UNSAFE", file.path);
    }
  }
  if (!seen.has("run.json")) issue("RUN_MISSING", "run.json");
  result.status = result.issues.length ? "invalid" : "verified";
  return result;
}

export function beginArtifacts(dir: string, lineage: RunLineage = {}): void {
  mkdirSync(dir, { recursive: true });
  if (existsSync(join(dir, "manifest.json")) || existsSync(join(dir, "run.json")))
    throw new Error("Run artifacts already exist; use a new runId");
  const now = new Date().toISOString();
  const manifest: ArtifactManifest = {
    v: 1,
    kind: "canary.artifact-manifest",
    runId: basename(dir),
    state: "partial",
    revision: 1,
    createdAt: now,
    updatedAt: now,
    lineage,
    files: [],
    privacy: { policy: "redact-v1", scanned: false },
  };
  atomicWrite(join(dir, "manifest.json"), JSON.stringify(artifactManifestSchema.parse(manifest), null, 2));
}

/** Caller owns the run lock while sealing; completed-run edits take manifest.lock below. */
type SealOptions = { state?: "sealed" | "recovered"; lineage?: RunLineage; privacy?: RedactionOptions };
function writeManifestRevision(dir: string, options: SealOptions = {}): ArtifactManifest {
  const previous = readArtifactManifest(dir);
  if (!previous) throw new ArtifactIntegrityError(verifyArtifacts(dir));
  const files: ArtifactManifest["files"] = [];
  const findings: Array<{ path: string; originalHash: string; sanitizedHash: string }> = [];
  for (const name of inventory(dir)) {
    if (name.endsWith(".tmp"))
      throw new ArtifactIntegrityError({
        v: 1,
        kind: "canary.artifact-integrity",
        runId: basename(dir),
        status: "invalid",
        issues: [{ code: "UNFINISHED_WRITE", path: name }],
      });
    const file = safeArtifactPath(dir, name);
    const bytes = readFileSync(file);
    if (!checkBody(name, bytes.toString("utf8")))
      throw new ArtifactIntegrityError({
        v: 1,
        kind: "canary.artifact-integrity",
        runId: basename(dir),
        status: "invalid",
        issues: [{ code: "CONTENT_INVALID", path: name }],
      });
    const text = bytes.toString("utf8");
    const json = name.endsWith(".json") ? JSON.parse(text) : undefined;
    const jsonl = name.endsWith(".jsonl")
      ? text
          .split(/\r?\n/)
          .filter((line) => line.trim())
          .map((line) => JSON.parse(line))
      : undefined;
    if (
      containsSensitiveText(text, options.privacy) ||
      (json !== undefined && containsSensitiveValue(json, options.privacy)) ||
      jsonl?.some((row) => containsSensitiveValue(row, options.privacy))
    ) {
      if (json !== undefined) writePrivateJson(file, json, options.privacy);
      else if (jsonl)
        atomicWrite(file, jsonl.map((row) => JSON.stringify(redactValue(row, options.privacy))).join("\n") + "\n");
      else writePrivateText(file, text, options.privacy);
      findings.push({ path: name, originalHash: sha256(bytes), sanitizedHash: sha256(readFileSync(file)) });
    }
    files.push({ path: name, bytes: bytes.length, sha256: sha256(bytes) });
  }
  if (findings.length) {
    writePrivateJson(join(dir, "privacy-findings.json"), {
      v: 1,
      kind: "canary.privacy-findings",
      policy: "redact-v1",
      findings,
    });
    throw new ArtifactPrivacyError();
  }
  const previousBytes = readFileSync(join(dir, "manifest.json"));
  const previousManifestHash = sha256(previousBytes);
  const historyDir = safeArtifactPath(dir, "manifest-history");
  mkdirSync(historyDir, { recursive: true });
  const historyFile = safeArtifactPath(historyDir, `${previousManifestHash}.json`);
  if (!existsSync(historyFile)) atomicWrite(historyFile, previousBytes.toString("utf8"));
  const manifest: ArtifactManifest = {
    ...previous,
    state: options.state ?? "sealed",
    revision: previous.revision + 1,
    updatedAt: new Date().toISOString(),
    previousManifestHash,
    lineage: options.lineage ?? previous.lineage,
    files,
    privacy: { policy: "redact-v1", scanned: true },
  };
  atomicWrite(join(dir, "manifest.json"), JSON.stringify(artifactManifestSchema.parse(manifest), null, 2));
  const verified = verifyArtifacts(dir);
  if (verified.status !== "verified") throw new ArtifactIntegrityError(verified);
  return manifest;
}

export function sealArtifacts(dir: string, options: SealOptions = {}): ArtifactManifest {
  const integrity = verifyArtifacts(dir);
  if (integrity.status !== "partial" && integrity.status !== "verified") throw new ArtifactIntegrityError(integrity);
  return writeManifestRevision(dir, options);
}

export function reviseArtifacts(
  dir: string,
  mutate: () => void,
  options: SealOptions & { allowPartial?: boolean } = {},
): void {
  const lock = safeArtifactPath(dir, "manifest.lock");
  const fd = openSync(lock, "wx");
  try {
    const integrity = verifyArtifacts(dir);
    if (integrity.status === "invalid" || (integrity.status === "partial" && !options.allowPartial))
      throw new ArtifactIntegrityError(integrity);
    mutate();
    if (integrity.status === "verified" || integrity.status === "partial") writeManifestRevision(dir, options);
  } finally {
    closeSync(fd);
    unlinkSync(lock);
  }
}

/** Legitimate derived-artifact updates preserve the prior manifest hash and reject existing corruption. */
export function updateArtifact(dir: string, name: string, value: unknown, privacy: RedactionOptions = {}): void {
  if (name === "manifest.json" || transient.has(name)) throw new Error("Reserved artifact name");
  mkdirSync(dir, { recursive: true });
  reviseArtifacts(
    dir,
    () => {
      writePrivateJson(safeArtifactPath(dir, name), value, privacy);
    },
    { privacy },
  );
}
