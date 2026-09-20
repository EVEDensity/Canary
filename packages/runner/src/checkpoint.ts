import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { RunSnapshot } from "@canary/core";
import { pidAlive, reclaimOrphans } from "@canary/isolation";
import { releaseRunLock, type IsolationFaultCode } from "./workspace.js";
import { ArtifactIntegrityError, readArtifactManifest, recoverTraceTail, redactRunSnapshot, reviseArtifacts, verifyArtifacts, writePrivateJson } from "@canary/trace";

export interface RunCheckpoint {
  v: 1;
  kind: "canary.checkpoint";
  runId: string;
  pid: number;
  status: "running" | "finalizing" | "interrupted" | "completed" | "failed" | "cancelled" | "recovered";
  startedAt: string;
  updatedAt: string;
  artifactDir: string;
  tmpDir: string;
  workDir: string;
  lockPath: string;
  ports: number[];
  childPids: number[];
  completedCaseKeys: string[];
  pendingCaseKeys: string[];
  termination?: "timeout" | "cancelled" | "budget_exceeded" | "error";
  recoveryOf?: string;
  fault?: IsolationFaultCode;
}

export function checkpointPath(artifactDir: string): string {
  return join(artifactDir, "checkpoint.json");
}

export function writeCheckpoint(checkpoint: RunCheckpoint): void {
  mkdirSync(checkpoint.artifactDir, { recursive: true });
  const file = checkpointPath(checkpoint.artifactDir);
  writePrivateJson(file, { ...checkpoint, updatedAt: new Date().toISOString() });
}

export function readCheckpoint(artifactDir: string): RunCheckpoint | undefined {
  const file = checkpointPath(artifactDir);
  if (!existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as RunCheckpoint;
    if (parsed?.kind !== "canary.checkpoint" || parsed.v !== 1) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function listCheckpoints(artifactRoot: string): RunCheckpoint[] {
  if (!existsSync(artifactRoot)) return [];
  try {
    return readdirSync(artifactRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => readCheckpoint(join(artifactRoot, entry.name)))
      .filter((item): item is RunCheckpoint => Boolean(item));
  } catch {
    return [];
  }
}

export function findCheckpointForPid(artifactRoot: string, pid: number, includeChildren = true): RunCheckpoint | undefined {
  const checkpoints = listCheckpoints(artifactRoot);
  return checkpoints.find((item) => item.pid === pid) ?? (includeChildren ? checkpoints.find((item) => item.childPids.includes(pid)) : undefined);
}

function caseKey(result: { caseId: string; repetition?: number }): string {
  return result.repetition ? `${result.caseId}#${result.repetition}` : result.caseId;
}

export interface RecoveredRun {
  checkpoint: RunCheckpoint;
  snapshot?: RunSnapshot;
  killedPids: number[];
  leftoverPids: number[];
}

/** Finish a crashed/stale run without re-executing completed cases or overwriting their results. */
export async function recoverPartialRun(artifactDir: string, snapshot?: RunSnapshot): Promise<RecoveredRun> {
  const dir = resolve(artifactDir);
  const integrity = verifyArtifacts(dir);
  if (integrity.status === "invalid") throw new ArtifactIntegrityError(integrity);
  const previousLineage = readArtifactManifest(dir)?.lineage;
  const current = readCheckpoint(dir);
  const startedAt = current?.startedAt ?? snapshot?.startedAt ?? new Date().toISOString();
  const runId = current?.runId ?? snapshot?.runId ?? dir.split(/[/\\]/).pop() ?? "unknown";
  const childPids = [...new Set([...(current?.childPids ?? []), ...(current?.pid && current.pid !== process.pid ? [current.pid] : [])])];
  const leftoverPids = await reclaimOrphans(childPids);
  const killedPids = childPids.filter((pid) => !leftoverPids.includes(pid));
  if (snapshot) {
    const recovered: RunSnapshot = {
      ...snapshot,
      status: snapshot.status === "running" || snapshot.status === "idle" ? "cancelled" : snapshot.status,
      finishedAt: snapshot.finishedAt ?? new Date().toISOString(),
      recoveryOf: runId,
      ...(snapshot.evidence ? { evidence: { ...snapshot.evidence, conclusionHash: undefined, lineage: { ...snapshot.evidence.lineage, ...previousLineage, recoveryOf: runId } } } : {}),
    } as RunSnapshot;
    snapshot = redactRunSnapshot(recovered);
  }
  const checkpoint: RunCheckpoint = {
    v: 1,
    kind: "canary.checkpoint",
    runId,
    pid: current?.pid ?? 0,
    status: leftoverPids.length ? "interrupted" : "recovered",
    startedAt,
    updatedAt: new Date().toISOString(),
    artifactDir: dir,
    tmpDir: current?.tmpDir ?? join(dir, "tmp"),
    workDir: current?.workDir ?? join(dir, "work"),
    lockPath: current?.lockPath ?? join(dir, "run.lock"),
    ports: current?.ports ?? [],
    childPids: leftoverPids.length ? leftoverPids : childPids,
    completedCaseKeys: current?.completedCaseKeys ?? snapshot?.results.map(caseKey) ?? [],
    pendingCaseKeys: current?.pendingCaseKeys ?? [],
    termination: current?.termination ?? "cancelled",
    recoveryOf: runId,
    fault: current?.fault,
  };
  if (leftoverPids.length) throw new Error("Worker processes remain; recovery is incomplete");
  for (const name of ["tmp", "work"]) {
    const target = resolve(dir, name);
    if (resolve(target, "..") !== dir) throw new Error("Unexpected recovery workspace path");
    if (existsSync(target)) {
      if (lstatSync(target).isSymbolicLink()) throw new Error("Unsafe recovery workspace path");
      rmSync(target, { recursive: true, force: true });
    }
  }
  reviseArtifacts(dir, () => {
    if (snapshot) writePrivateJson(join(dir, "run.json"), snapshot);
    const traceRepair = recoverTraceTail(dir);
    writePrivateJson(join(dir, "recovery.json"), { v: 1, kind: "canary.recovery", runId, recoveredAt: new Date().toISOString(), priorIntegrity: integrity.status, priorManifestHash: integrity.manifestHash, traceRepair, completedCaseKeys: checkpoint.completedCaseKeys, pendingCaseKeys: checkpoint.pendingCaseKeys, killedPids, leftoverPids });
    writeCheckpoint(checkpoint);
  }, { allowPartial: true, state: "recovered", lineage: snapshot?.evidence?.lineage ?? { recoveryOf: runId } });
  releaseRunLock(checkpoint.lockPath, current?.pid);
  return { checkpoint, snapshot, killedPids, leftoverPids };
}

export async function recoverStaleRuns(artifactRoot: string, readSnapshot: (runId: string) => RunSnapshot | undefined): Promise<RecoveredRun[]> {
  const recovered: RecoveredRun[] = [];
  for (const checkpoint of listCheckpoints(artifactRoot)) {
    const liveOwner = checkpoint.pid > 0 && pidAlive(checkpoint.pid);
    const open = checkpoint.status === "running" || checkpoint.status === "finalizing" || checkpoint.status === "interrupted" || verifyArtifacts(checkpoint.artifactDir).status === "partial";
    if (liveOwner || !open) continue;
    let snapshot: RunSnapshot | undefined;
    try {
      snapshot = readSnapshot(checkpoint.runId);
    } catch {
      snapshot = undefined;
    }
    recovered.push(await recoverPartialRun(checkpoint.artifactDir, snapshot));
  }
  return recovered;
}
