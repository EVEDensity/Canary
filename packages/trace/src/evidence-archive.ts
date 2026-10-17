import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmdirSync,
  writeFileSync,
  openSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  ARCHIVE_LIMITS,
  archiveAuthorizationSchema,
  parseArchiveManifest,
  parseArchivePlan,
  parseImprovementSession,
  parseQualityRecord,
  parseRunSnapshot,
  projectMemoryProjectId,
  qualityContentHash,
  QUALITY_MAX_RECORD_BYTES,
  IMPROVEMENT_MAX_RECORD_BYTES,
  type EvidenceArchiveManifest,
  type RunSnapshot,
} from "@canary/core";
import { atomicWrite, readArtifactManifest, sha256, verifyArtifacts } from "./artifacts.js";
import { ordinaryCollectionPath, inspectCollectionLocks, withCollectionMutation } from "./collection-guard.js";
import { qualityOrdinaryParents, readQualityBytes } from "./quality-assessment.js";
import { containsSensitiveText, containsSensitiveValue } from "./privacy.js";

export class EvidenceArchiveError extends Error {
  constructor(
    readonly code:
      "ARCHIVE_INPUT" | "ARCHIVE_BUSY" | "ARCHIVE_EVIDENCE" | "ARCHIVE_STALE" | "ARCHIVE_CONFLICT" | "ARCHIVE_LIMIT",
    message: string,
  ) {
    super(message);
  }
}
function fail(code: EvidenceArchiveError["code"], message: string): never {
  throw new EvidenceArchiveError(code, message);
}
const id = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
type Snapshot = Pick<
  EvidenceArchiveManifest,
  "files" | "directories" | "runIds" | "qualityRecords" | "improvementSessions"
>;
function canonicalTarget(path: string): string {
  qualityOrdinaryParents(path);
  let parent = resolve(path),
    suffix: string[] = [];
  while (!existsSync(parent)) {
    suffix.unshift(basename(parent));
    parent = dirname(parent);
  }
  return join(ordinaryCollectionPath(parent), ...suffix);
}
function disjoint(root: string, target: string): void {
  const inside = (a: string, b: string) => {
    const rel = relative(a, b);
    return rel === "" || (!isAbsolute(rel) && !rel.startsWith(`..${sep}`) && rel !== "..");
  };
  if (inside(root, target) || inside(target, root))
    fail("ARCHIVE_INPUT", "Archive storage must be outside the artifact collection and must not contain it.");
}
function inventory(root: string): Pick<Snapshot, "files" | "directories"> {
  ordinaryCollectionPath(root);
  if (!existsSync(root)) fail("ARCHIVE_EVIDENCE", "The evidence collection is missing.");
  const files: Snapshot["files"] = [],
    directories: string[] = [];
  let total = 0;
  const walk = (dir: string, depth: number) => {
    if (depth > 48) fail("ARCHIVE_LIMIT", "Archive directory depth exceeded.");
    for (const name of readdirSync(dir).sort()) {
      if (!/^[A-Za-z0-9_.-]+$/.test(name) || name === "." || name === "..")
        fail("ARCHIVE_EVIDENCE", "Unsupported archive path.");
      if (name.endsWith(".lock") || name.endsWith(".tmp"))
        fail("ARCHIVE_BUSY", "A writer or incomplete write remains; inspect recovery before archiving.");
      const file = join(dir, name),
        stat = lstatSync(file),
        path = relative(root, file).split(sep).join("/");
      if (stat.isSymbolicLink()) fail("ARCHIVE_EVIDENCE", "Linked evidence cannot be archived.");
      if (stat.isDirectory()) {
        directories.push(path);
        if (directories.length > ARCHIVE_LIMITS.directories)
          fail("ARCHIVE_LIMIT", "Archive directory budget exceeded.");
        walk(file, depth + 1);
      } else if (stat.isFile()) {
        if (stat.nlink !== 1 || stat.size > ARCHIVE_LIMITS.fileBytes || files.length >= ARCHIVE_LIMITS.files)
          fail("ARCHIVE_LIMIT", "Archive file budget exceeded or an unshared file is required.");
        const bytes = readQualityBytes(file, ARCHIVE_LIMITS.fileBytes);
        total += bytes.length;
        if (total > ARCHIVE_LIMITS.totalBytes) fail("ARCHIVE_LIMIT", "Archive total byte budget exceeded.");
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if (containsSensitiveText(text) || (path.endsWith(".json") && containsSensitiveValue(JSON.parse(text))))
          fail(
            "ARCHIVE_EVIDENCE",
            "Evidence privacy validation failed; retain the original collection for inspection.",
          );
        files.push({ path, bytes: bytes.length, sha256: sha256(bytes) });
      } else fail("ARCHIVE_EVIDENCE", "Only ordinary evidence files and directories can be archived.");
    }
  };
  walk(root, 0);
  return { files: files.sort((a, b) => a.path.localeCompare(b.path)), directories: directories.sort() };
}
function snapshot(root: string, projectId: string, originalRoot = root): Snapshot {
  try {
    return snapshotUnchecked(root, projectId, originalRoot);
  } catch (error) {
    if (error instanceof EvidenceArchiveError) throw error;
    return fail(
      "ARCHIVE_EVIDENCE",
      "Evidence records are invalid, incomplete or changed while reading; preserve the collection for inspection.",
    );
  }
}
function snapshotUnchecked(root: string, projectId: string, originalRoot: string): Snapshot {
  const tree = inventory(root),
    runIds: string[] = [],
    references = new Set<string>();
  let qualityRecords = 0,
    improvementSessions = 0;
  const json = (path: string, max: number = ARCHIVE_LIMITS.fileBytes) =>
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readQualityBytes(join(root, ...path.split("/")), max)));
  for (const name of readdirSync(root).sort()) {
    if (name === ".quality" || name === ".improvements") {
      for (const file of readdirSync(join(root, name))) {
        const path = `${name}/${file}`;
        if (name === ".quality") {
          if (!/^quality_[a-f0-9]{24}\.json$/.test(file)) fail("ARCHIVE_EVIDENCE", "Unsupported quality record.");
          const record = parseQualityRecord(json(path, QUALITY_MAX_RECORD_BYTES));
          qualityRecords++;
          if (
            qualityRecords > 128 ||
            record.projectId !== projectId ||
            file !== `quality_${qualityContentHash({ projectId, runId: record.runId }).slice(0, 24)}.json`
          )
            fail("ARCHIVE_EVIDENCE", "Quality record identity or quota mismatch.");
          references.add(record.runId);
          for (const report of record.reports) {
            for (const issue of report.issues) for (const evidence of issue.evidence) references.add(evidence.runId);
            for (const history of report.history) references.add(history.runId);
          }
        } else {
          const record = parseImprovementSession(json(path, IMPROVEMENT_MAX_RECORD_BYTES));
          improvementSessions++;
          if (improvementSessions > 64 || record.plan.projectId !== projectId || file !== `${record.plan.id}.json`)
            fail("ARCHIVE_EVIDENCE", "Improvement record identity or quota mismatch.");
          if (record.attempts.some((a) => a.state === "running"))
            fail("ARCHIVE_BUSY", "Recover the interrupted improvement before archiving.");
          references.add(record.plan.baseline.runId);
          for (const attempt of record.attempts)
            if (attempt.result?.candidateRunId) references.add(attempt.result.candidateRunId);
        }
      }
      continue;
    }
    if (!id.test(name) || name === "." || name === ".." || !lstatSync(join(root, name)).isDirectory())
      fail("ARCHIVE_EVIDENCE", "Unsupported collection entry.");
    if (runIds.length >= ARCHIVE_LIMITS.runs) fail("ARCHIVE_LIMIT", "Archive run budget exceeded.");
    const dir = join(root, name),
      integrity = verifyArtifacts(dir, new Set(), originalRoot),
      run = parseRunSnapshot(json(`${name}/run.json`)) as RunSnapshot;
    if (
      integrity.status !== "verified" ||
      run.runId !== name ||
      !["completed", "failed", "cancelled"].includes(run.status)
    )
      fail(
        "ARCHIVE_EVIDENCE",
        "Archive requires sealed, finalized runs; legacy, partial or damaged evidence remains in place.",
      );
    runIds.push(name);
    const lineage = readArtifactManifest(dir)!.lineage;
    for (const ref of [lineage.replayOf, lineage.retryOf, lineage.candidateOf, lineage.recoveryOf])
      if (ref && ref !== name) references.add(ref);
    for (const check of run.checks ?? []) if (check.childRun) references.add(check.childRun.runId);
  }
  if (!runIds.length) fail("ARCHIVE_EVIDENCE", "There are no sealed runs to archive.");
  if ([...references].some((ref) => !runIds.includes(ref)))
    fail("ARCHIVE_EVIDENCE", "Referenced run evidence is missing; restore it before archiving the collection.");
  return { ...tree, runIds, qualityRecords, improvementSessions };
}
function idle(root: string) {
  if (inspectCollectionLocks(root).locks.length)
    fail("ARCHIVE_BUSY", "Collection operations are active or interrupted; inspect archive recover before continuing.");
}
function createPlan(root: string, target: string, mode: "copy" | "rotate") {
  const source = ordinaryCollectionPath(root),
    destination = canonicalTarget(target);
  disjoint(source, destination);
  if (existsSync(destination)) fail("ARCHIVE_CONFLICT", "Archive destination already exists; choose a new directory.");
  const projectId = projectMemoryProjectId(source),
    state = snapshot(source, projectId);
  const value = {
    v: 1 as const,
    kind: "canary.archive-plan" as const,
    action: "create" as const,
    mode,
    projectId,
    targetHash: sha256(destination),
    snapshotHash: qualityContentHash(state),
    runs: state.runIds.length,
    qualityRecords: state.qualityRecords,
    improvementSessions: state.improvementSessions,
    files: state.files.length,
    bytes: state.files.reduce((n, f) => n + f.bytes, 0),
    executionGranted: false as const,
  };
  return { source, destination, state, plan: parseArchivePlan({ ...value, contentHash: qualityContentHash(value) }) };
}
export function planEvidenceArchive(root: string, target: string, mode: "copy" | "rotate" = "copy") {
  idle(root);
  return createPlan(root, target, mode).plan;
}
function authorize(value: unknown) {
  const parsed = archiveAuthorizationSchema.safeParse(value);
  if (!parsed.success || containsSensitiveValue(parsed.data))
    fail("ARCHIVE_INPUT", "An exact plan hash, actor and reason without credentials are required.");
  return parsed.data;
}
function copyTree(source: string, target: string, state: Snapshot) {
  mkdirSync(target, { recursive: true });
  for (const dir of state.directories) mkdirSync(join(target, ...dir.split("/")), { recursive: true });
  for (const file of state.files) {
    const destination = join(target, ...file.path.split("/"));
    copyFileSync(join(source, ...file.path.split("/")), destination, constants.COPYFILE_EXCL);
    const fd = openSync(destination, "r+");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
}
function durableJson(file: string, value: unknown) {
  const fd = openSync(file, "wx", 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function manifestFor(
  state: Snapshot,
  projectId: string,
  request: ReturnType<typeof authorize>,
  mode: "copy" | "rotate",
): EvidenceArchiveManifest {
  const value = {
    v: 1 as const,
    kind: "canary.evidence-archive" as const,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    projectId,
    ...request,
    mode,
    ...state,
    contentHash: "",
  };
  return parseArchiveManifest({ ...value, contentHash: qualityContentHash(value) });
}
export function readEvidenceArchive(root: string, bundle: string): EvidenceArchiveManifest {
  try {
    return readEvidenceArchiveUnchecked(root, bundle);
  } catch (error) {
    if (error instanceof EvidenceArchiveError) throw error;
    return fail(
      "ARCHIVE_EVIDENCE",
      "The archive is unsafe, incomplete or corrupt; the original collection was not replaced.",
    );
  }
}
function readEvidenceArchiveUnchecked(root: string, bundle: string): EvidenceArchiveManifest {
  const source = ordinaryCollectionPath(root),
    archive = ordinaryCollectionPath(bundle);
  disjoint(source, archive);
  if (readdirSync(archive).sort().join("|") !== "archive.json|collection")
    fail("ARCHIVE_EVIDENCE", "Archive is incomplete or has unexpected entries.");
  const manifest = parseArchiveManifest(
    JSON.parse(readQualityBytes(join(archive, "archive.json"), ARCHIVE_LIMITS.manifestBytes).toString("utf8")),
  );
  if (manifest.projectId !== projectMemoryProjectId(source))
    fail(
      "ARCHIVE_INPUT",
      "This archive belongs to another artifact location; restore to its original project location.",
    );
  const actual = snapshot(join(archive, "collection"), manifest.projectId, source);
  const expected: Snapshot = {
    files: manifest.files,
    directories: manifest.directories,
    runIds: manifest.runIds,
    qualityRecords: manifest.qualityRecords,
    improvementSessions: manifest.improvementSessions,
  };
  if (qualityContentHash(actual) !== qualityContentHash(expected))
    fail("ARCHIVE_EVIDENCE", "Archive contents do not match the immutable manifest.");
  return manifest;
}
export function createEvidenceArchive(root: string, target: string, mode: "copy" | "rotate", value: unknown) {
  const request = authorize(value);
  return withCollectionMutation(root, () => {
    const current = createPlan(root, target, mode);
    if (current.plan.contentHash !== request.planHash)
      fail("ARCHIVE_STALE", "Collection or destination changed; review a fresh archive plan.");
    const manifest = manifestFor(current.state, current.plan.projectId, request, mode),
      stage = `${current.destination}.pending_${manifest.id}`;
    qualityOrdinaryParents(dirname(stage));
    mkdirSync(dirname(stage), { recursive: true });
    ordinaryCollectionPath(dirname(stage));
    mkdirSync(stage);
    // The manifest is durable before moving source bytes. A pending bundle remains inspectable after interruption.
    const body = JSON.stringify(manifest);
    if (Buffer.byteLength(body) > ARCHIVE_LIMITS.manifestBytes)
      fail("ARCHIVE_LIMIT", "Archive manifest budget exceeded.");
    durableJson(join(stage, "archive.json"), manifest);
    let moved = false;
    try {
      if (mode === "rotate") {
        renameSync(current.source, join(stage, "collection"));
        moved = true;
      } else copyTree(current.source, join(stage, "collection"), current.state);
      readEvidenceArchive(current.source, stage);
      if (
        !moved &&
        qualityContentHash(snapshot(current.source, current.plan.projectId)) !== qualityContentHash(current.state)
      )
        fail("ARCHIVE_STALE", "Source evidence changed while copying; the source was preserved.");
      if (existsSync(current.destination))
        fail("ARCHIVE_CONFLICT", "Archive destination appeared before publication; existing contents were preserved.");
      renameSync(stage, current.destination);
      if (moved) mkdirSync(current.source);
      return {
        v: 1 as const,
        kind: "canary.archive-receipt" as const,
        action: "create" as const,
        archiveHash: manifest.contentHash,
        planHash: request.planHash,
        mode,
        runs: manifest.runIds.length,
        sourceReset: moved,
        executionGranted: false as const,
      };
    } catch (error) {
      if (moved && !existsSync(current.source) && existsSync(join(stage, "collection")))
        renameSync(join(stage, "collection"), current.source);
      throw error;
    }
  });
}
function restorePlan(root: string, bundle: string) {
  const source = ordinaryCollectionPath(root),
    archive = ordinaryCollectionPath(bundle),
    manifest = readEvidenceArchive(source, archive);
  if (existsSync(source) && readdirSync(source).length)
    fail(
      "ARCHIVE_CONFLICT",
      "Restore requires an absent or empty collection; archive current evidence first. Existing records are never overwritten.",
    );
  const value = {
    v: 1 as const,
    kind: "canary.archive-plan" as const,
    action: "restore" as const,
    projectId: manifest.projectId,
    targetHash: sha256(source),
    archivePathHash: sha256(archive),
    archiveHash: manifest.contentHash,
    targetState: existsSync(source) ? "empty" : "missing",
    runs: manifest.runIds.length,
    files: manifest.files.length,
    bytes: manifest.files.reduce((n, f) => n + f.bytes, 0),
    executionGranted: false as const,
  };
  return { source, archive, manifest, plan: parseArchivePlan({ ...value, contentHash: qualityContentHash(value) }) };
}
export function planEvidenceRestore(root: string, bundle: string) {
  idle(root);
  return restorePlan(root, bundle).plan;
}
export function restoreEvidenceArchive(root: string, bundle: string, value: unknown) {
  const request = authorize(value);
  return withCollectionMutation(root, () => {
    const current = restorePlan(root, bundle);
    if (current.plan.contentHash !== request.planHash)
      fail("ARCHIVE_STALE", "Archive or target changed; review a fresh restore plan.");
    const audit = join(dirname(current.archive), "audit");
    qualityOrdinaryParents(audit);
    mkdirSync(audit, { recursive: true });
    ordinaryCollectionPath(audit);
    const auditFile = join(audit, `restore_${randomUUID()}.json`);
    const stage = `${current.source}.restore_${randomUUID()}`;
    copyTree(join(current.archive, "collection"), stage, current.manifest);
    if (
      qualityContentHash(snapshot(stage, current.manifest.projectId, current.source)) !==
      qualityContentHash({
        files: current.manifest.files,
        directories: current.manifest.directories,
        runIds: current.manifest.runIds,
        qualityRecords: current.manifest.qualityRecords,
        improvementSessions: current.manifest.improvementSessions,
      })
    )
      fail("ARCHIVE_EVIDENCE", "Restore verification failed; the archive and current collection are preserved.");
    // Recheck the archive and empty target before publishing; never replace a populated collection.
    if (restorePlan(root, bundle).plan.contentHash !== request.planHash)
      fail("ARCHIVE_STALE", "Restore inputs changed before publication.");
    const receipt = {
      v: 1 as const,
      kind: "canary.archive-receipt" as const,
      action: "restore" as const,
      archiveHash: current.manifest.contentHash,
      ...request,
      at: new Date().toISOString(),
      runs: current.manifest.runIds.length,
      executionGranted: false as const,
    };
    durableJson(auditFile, { ...receipt, state: "prepared" });
    if (existsSync(current.source)) rmdirSync(current.source);
    renameSync(stage, current.source);
    atomicWrite(auditFile, JSON.stringify({ ...receipt, state: "restored" }));
    return receipt;
  });
}
