import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import {
  parseRunSnapshot,
  projectMemoryProjectId,
  qualityContentHash,
  type ArtifactOptions,
  type RunSnapshot,
} from "@canary/core";
import { readArtifactManifest, safeArtifactPath, sha256, verifyArtifacts } from "./artifacts.js";
import { qualityOrdinaryParents, readQualityBytes } from "./quality-assessment.js";
import { retentionReferences, RetentionError, type RetentionBlocker } from "./retention-references.js";
import { withCollectionMutation } from "./collection-guard.js";
export { RetentionError, type RetentionBlocker } from "./retention-references.js";

export interface RetentionPlan {
  v: 1;
  kind: "canary.retention";
  candidates: string[];
  protectedRuns: string[];
  retainedBytes: number;
  withinBudget: boolean;
  referenceHash: string;
  collectionHash: string;
  blockers: RetentionBlocker[];
}
function directoryBytes(dir: string): number {
  return readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => {
    const file = join(dir, entry.name);
    if (entry.isSymbolicLink()) return sum;
    return sum + (entry.isDirectory() ? directoryBytes(file) : lstatSync(file).size);
  }, 0);
}
function collection(root: string) {
  const blockers: RetentionBlocker[] = [];
  const rows = existsSync(root)
    ? readdirSync(root, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() && !entry.isSymbolicLink() && ![".quality", ".improvements"].includes(entry.name),
        )
        .map((entry) => {
          const dir = safeArtifactPath(root, entry.name),
            integrity = verifyArtifacts(dir);
          let startedAt = 0;
          let active = true;
          const parents = new Set<string>();
          try {
            if (integrity.status === "invalid")
              throw new Error("Run references have failed their manifest verification");
            const raw = readQualityBytes(join(dir, "run.json"), 16_777_216),
              run = parseRunSnapshot(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw))) as RunSnapshot,
              manifest = readArtifactManifest(dir);
            if (run.runId !== entry.name) throw new Error("Run identity mismatch");
            if (integrity.status === "verified") {
              const binding = manifest?.files.find((file) => file.path === "run.json");
              if (!binding || binding.sha256 !== sha256(raw) || binding.bytes !== raw.length)
                throw new Error("Run changed during retention inventory");
            }
            startedAt = Date.parse(run.startedAt);
            active = !["completed", "failed", "cancelled"].includes(run.status);
            const lineage = manifest?.lineage ?? run.evidence?.lineage ?? run;
            for (const parent of [lineage.replayOf, lineage.candidateOf, lineage.retryOf, lineage.recoveryOf])
              if (typeof parent === "string" && parent !== entry.name) parents.add(parent);
            if (run.checks !== undefined && !Array.isArray(run.checks)) throw new Error("Malformed child references");
            for (const check of run.checks ?? [])
              if (check.childRun) {
                const id = check.childRun.runId;
                if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id) || id === "." || id === "..")
                  throw new Error("Invalid child identity");
                parents.add(id);
              }
            const final = verifyArtifacts(dir);
            if (final.status !== integrity.status || final.manifestHash !== integrity.manifestHash)
              throw new Error("Collection changed during retention inventory");
          } catch {
            blockers.push({
              code: "RETENTION_EVIDENCE",
              store: entry.name,
              message: "Run references are unreadable or changed; restore or finish this run before pruning.",
            });
          }
          return {
            id: entry.name,
            bytes: directoryBytes(dir),
            status: integrity.status,
            manifestHash: integrity.manifestHash,
            startedAt,
            active,
            parents: [...parents],
            locked: existsSync(join(dir, "run.lock")) || existsSync(join(dir, "manifest.lock")),
          };
        })
        .sort((a, b) => b.startedAt - a.startedAt || a.id.localeCompare(b.id))
    : [];
  return { rows, blockers, hash: qualityContentHash(rows.map(({ bytes: _bytes, locked: _locked, ...row }) => row)) };
}
/** Opt-in only. Retained decisions, sessions and all retained lineage protect their source evidence. */
export function planRetention(
  root: string,
  policy: NonNullable<ArtifactOptions["retention"]>,
  protect: string[] = [],
  now = Date.now(),
): RetentionPlan {
  const maintenanceBusy=existsSync(`${resolve(root)}.maintenance.lock`)||existsSync(`${resolve(root)}.maintenance-recovery.lock`);
  if (!existsSync(root))
    return {
      v: 1,
      kind: "canary.retention",
      candidates: [],
      protectedRuns: protect,
      retainedBytes: 0,
      withinBudget: !maintenanceBusy,
      referenceHash: qualityContentHash([]),
      collectionHash: qualityContentHash([]),
      blockers: maintenanceBusy?[{store:".",code:"RETENTION_BUSY",message:"Interrupted collection maintenance requires inspection before pruning."}]:[],
    };
  const references = retentionReferences(root),
    {
      rows,
      blockers: runBlockers,
      hash,
    } = references.blockers.some((blocker) => blocker.store === ".")
      ? { rows: [], blockers: [], hash: qualityContentHash([]) }
      : collection(root),
    blockers:RetentionBlocker[] = [...references.blockers, ...runBlockers,
      ...(readdirSync(root).some(name=>/^\.operation_[-a-f0-9]{36}\.lock$/.test(name))||existsSync(`${resolve(root)}.maintenance.lock`)||existsSync(`${resolve(root)}.maintenance-recovery.lock`)?[{store:".",code:"RETENTION_BUSY" as const,message:"A collection operation or maintenance lock is active or interrupted; inspect recovery before pruning."}]:[])],
    protectedIds = new Set([...protect, ...references.runIds]),
    candidates = new Set<string>();
  let count = 0,
    bytes = 0;
  for (const row of rows) {
    const eligible =
      !blockers.length &&
      row.status === "verified" &&
      !row.active &&
      !row.locked &&
      Number.isFinite(row.startedAt) &&
      !protectedIds.has(row.id);
    if (
      eligible &&
      ((policy.maxRuns !== undefined && count >= policy.maxRuns) ||
        (policy.maxAgeDays !== undefined && now - row.startedAt > policy.maxAgeDays * 86_400_000) ||
        (policy.maxBytes !== undefined && bytes + row.bytes > policy.maxBytes))
    )
      candidates.add(row.id);
    else {
      count++;
      bytes += row.bytes;
      if (!eligible) protectedIds.add(row.id);
    }
  }
  const byId = new Map(rows.map((row) => [row.id, row]));
  const keepAncestors = (id: string): void => {
    for (const parent of byId.get(id)?.parents ?? []) {
      if (protectedIds.has(parent)) continue;
      protectedIds.add(parent);
      candidates.delete(parent);
      keepAncestors(parent);
    }
  };
  // Walk every retained root, including roots already protected by a decision/session.
  for (const row of rows) if (!candidates.has(row.id)) keepAncestors(row.id);
  const retained = rows.filter((row) => !candidates.has(row.id)),
    retainedBytes = retained.reduce((sum, row) => sum + row.bytes, 0);
  return {
    v: 1,
    kind: "canary.retention",
    candidates: [...candidates],
    protectedRuns: [...protectedIds].sort(),
    retainedBytes,
    withinBudget:
      !blockers.length &&
      (policy.maxBytes === undefined || retainedBytes <= policy.maxBytes) &&
      (policy.maxRuns === undefined || retained.length <= policy.maxRuns),
    referenceHash: references.hash,
    collectionHash: hash,
    blockers,
  };
}

/** Lock the same records/catalog used by decision and improvement writers before checking references again. */
function lockReferences(base: string, runIds: string[], recordFiles: string[]) {
  const projectId = projectMemoryProjectId(base),
    paths = new Set(recordFiles.map((file) => `${file}.lock`));
  for (const file of recordFiles) if (dirname(file) === join(base, ".improvements")) paths.add(`${file}.recover.lock`);
  // New quality records have deterministic names. Lock retained roots too: their histories can refer to a candidate.
  for (const id of runIds)
    paths.add(join(base, ".quality", `quality_${qualityContentHash({ projectId, runId: id }).slice(0, 24)}.json.lock`));
  paths.add(join(base, ".improvements", "catalog.lock"));
  if (paths.size > 4096)
    throw new RetentionError(
      "RETENTION_STORAGE",
      "Reference lock budget exceeded; split the artifact collection before pruning.",
    );
  const held: Array<{ file: string; fd: number; dev: number; ino: number }> = [];
  const release = () => {
    for (const item of held.reverse()) {
      const current = lstatSync(item.file, { throwIfNoEntry: false });
      closeSync(item.fd);
      if (current?.dev === item.dev && current.ino === item.ino && !current.isSymbolicLink()) unlinkSync(item.file);
    }
  };
  try {
    for (const name of [".quality", ".improvements"]) {
      const dir = join(base, name);
      qualityOrdinaryParents(dir);
      mkdirSync(dir, { recursive: true });
      qualityOrdinaryParents(dir);
    }
    for (const file of [...paths].sort()) {
      const fd = openSync(file, "wx", 0o600),
        stat = fstatSync(fd);
      held.push({ file, fd, dev: stat.dev, ino: stat.ino });
      writeFileSync(fd, JSON.stringify({ pid: process.pid, nonce: randomUUID() }));
      fsyncSync(fd);
    }
    return { release, ownLocks: new Set(held.map((item) => item.file)) };
  } catch {
    release();
    throw new RetentionError(
      "RETENTION_BUSY",
      "A reference writer is active or interrupted; inspect its lock before pruning.",
    );
  }
}
export function applyRetention(root: string, plan: RetentionPlan): string[] {
  return withCollectionMutation(root,()=>applyRetentionUnlocked(root,plan));
}
function applyRetentionUnlocked(root:string,plan:RetentionPlan):string[] {
  if(existsSync(root)&&readdirSync(root).some(name=>/^\.operation_[-a-f0-9]{36}\.lock$/.test(name)))throw new RetentionError("RETENTION_BUSY","A collection operation is active or interrupted; inspect recovery before pruning.");
  const removed: string[] = [];
  if (!existsSync(root)) return removed;
  if (plan.blockers?.length) throw new RetentionError(plan.blockers[0]!.code, plan.blockers[0]!.message);
  const initial = retentionReferences(root);
  if (initial.blockers.length) throw new RetentionError(initial.blockers[0]!.code, initial.blockers[0]!.message);
  const base = realpathSync.native(resolve(root)),
    initialCollection = collection(base);
  if (
    initial.hash !== plan.referenceHash ||
    initialCollection.hash !== plan.collectionHash ||
    initialCollection.blockers.length
  )
    throw new RetentionError(
      "RETENTION_STALE",
      "Evidence or references changed; review a fresh retention plan before pruning.",
    );
  if (!plan.candidates.length) return removed;
  const held = lockReferences(
    base,
    initialCollection.rows.map((row) => row.id),
    initial.recordFiles,
  );
  try {
    const assertReferences = () => {
      const current = retentionReferences(base, held.ownLocks);
      if (current.blockers.length) throw new RetentionError(current.blockers[0]!.code, current.blockers[0]!.message);
      if (current.hash !== plan.referenceHash)
        throw new RetentionError(
          "RETENTION_STALE",
          "Decision or improvement references changed; refresh the retention plan.",
        );
      return new Set(current.runIds);
    };
    const referenced = assertReferences(),
      rows = collection(base),
      byId = new Map(rows.rows.map((row) => [row.id, row]));
    if (rows.hash !== plan.collectionHash || rows.blockers.length)
      throw new RetentionError("RETENTION_STALE", "Run evidence changed; refresh the retention plan.");
    const visitKeep = (id: string) => {
      for (const parent of byId.get(id)?.parents ?? [])
        if (!referenced.has(parent)) {
          referenced.add(parent);
          visitKeep(parent);
        }
    };
    // A run can become busy after preview. Keeping it also keeps its lineage dependencies.
    for (const row of rows.rows) if (row.locked || row.active || row.status !== "verified") referenced.add(row.id);
    for (const row of rows.rows) if (!plan.candidates.includes(row.id) || referenced.has(row.id)) visitKeep(row.id);
    const ordered: string[] = [],
      visited = new Set<string>();
    const visitDelete = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      for (const dependency of byId.get(id)?.parents ?? [])
        if (plan.candidates.includes(dependency)) visitDelete(dependency);
      ordered.push(id);
    };
    for (const id of plan.candidates) visitDelete(id);
    for (const id of ordered.reverse()) {
      const dir = safeArtifactPath(base, id);
      if (
        resolve(dir, "..") !== base ||
        referenced.has(id) ||
        plan.protectedRuns.includes(id) ||
        existsSync(join(dir, "run.lock")) ||
        existsSync(join(dir, "manifest.lock")) ||
        verifyArtifacts(dir).status !== "verified"
      )
        continue;
      assertReferences();
      // A newly created referrer or changed manifest requires another review before any further deletion.
      const latest = collection(base),
        expected = rows.rows.filter((row) => !removed.includes(row.id));
      if (
        latest.blockers.length ||
        latest.hash !== qualityContentHash(expected.map(({ bytes: _bytes, locked: _locked, ...row }) => row))
      )
        throw new RetentionError("RETENTION_STALE", "Run references changed while pruning; review a fresh plan.");
      for (const row of latest.rows)
        if (row.locked || row.active || row.status !== "verified") {
          referenced.add(row.id);
          visitKeep(row.id);
        }
      if (referenced.has(id)) continue;
      const lock = safeArtifactPath(dir, "manifest.lock");
      let fd: number;
      try {
        fd = openSync(lock, "wx");
      } catch {
        throw new RetentionError(
          "RETENTION_BUSY",
          "A run writer is active; refresh the retention plan after it finishes.",
        );
      }
      closeSync(fd);
      try {
        if (existsSync(join(dir, "run.lock")) || verifyArtifacts(dir).status !== "verified") continue;
        assertReferences();
        rmSync(dir, { recursive: true, force: false });
        removed.push(id);
      } finally {
        if (existsSync(lock)) unlinkSync(lock);
      }
    }
    return removed;
  } finally {
    held.release();
  }
}
