import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import type { RunSnapshot } from "@canary/core";
import { pidAlive } from "@canary/isolation";
import { acquireRunLock, releaseRunLock, type IsolationFaultCode } from "./workspace.js";
import {
  ArtifactIntegrityError,
  readArtifactManifest,
  recoverTraceTail,
  redactRunSnapshot,
  reviseArtifacts,
  verifyArtifacts,
  writePrivateJson,
} from "@canary/trace";

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

export class RunRecoveryError extends Error {
  constructor(
    readonly code:
      | "RUN_RECOVERY_CHECKPOINT"
      | "RUN_RECOVERY_PATH"
      | "RUN_RECOVERY_LIVE_OWNER"
      | "RUN_RECOVERY_UNPROVEN_PROCESS"
      | "RUN_RECOVERY_FINALIZED",
    message: string,
  ) {
    super(message);
    this.name = "RunRecoveryError";
  }
}

const MAX_CHECKPOINT_BYTES = 2_097_152;
function invalidCheckpoint(): never {
  throw new RunRecoveryError(
    "RUN_RECOVERY_CHECKPOINT",
    "Checkpoint is missing, corrupt or outside its supported limits; inspect the retained evidence before recovery.",
  );
}
function ordinaryDirectory(path: string): string {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat?.isDirectory() || stat.isSymbolicLink())
    throw new RunRecoveryError(
      "RUN_RECOVERY_PATH",
      "Recovery requires an ordinary run directory, not a symbolic link.",
    );
  return realpathSync.native(resolve(path));
}
function boundedBytes(file: string): Buffer {
  const before = lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > MAX_CHECKPOINT_BYTES)
    invalidCheckpoint();
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.dev !== before.dev ||
      stat.ino !== before.ino ||
      stat.size > MAX_CHECKPOINT_BYTES
    )
      invalidCheckpoint();
    const buffer = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const amount = readSync(fd, buffer, length, buffer.length - length, null);
      if (!amount) break;
      length += amount;
    }
    const after = fstatSync(fd);
    if (length !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) invalidCheckpoint();
    return buffer.subarray(0, length);
  } finally {
    closeSync(fd);
  }
}
function validateCheckpoint(value: unknown, artifactDir: string): RunCheckpoint {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidCheckpoint();
  const item = value as Record<string, unknown>;
  const allowed = new Set([
    "v",
    "kind",
    "runId",
    "pid",
    "status",
    "startedAt",
    "updatedAt",
    "artifactDir",
    "tmpDir",
    "workDir",
    "lockPath",
    "ports",
    "childPids",
    "completedCaseKeys",
    "pendingCaseKeys",
    "termination",
    "recoveryOf",
    "fault",
  ]);
  const identifier = (text: unknown): text is string =>
    typeof text === "string" &&
    text.length <= 180 &&
    /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(text) &&
    text !== "." &&
    text !== "..";
  const pid = (number: unknown) =>
    Number.isSafeInteger(number) && Number(number) >= 0 && Number(number) <= 2_147_483_647;
  const list = (items: unknown, maximum: number, accept: (item: unknown) => boolean) =>
    Array.isArray(items) && items.length <= maximum && items.every(accept) && new Set(items).size === items.length;
  const timestamp = (text: unknown) =>
    typeof text === "string" &&
    text.length <= 40 &&
    /^\d{4}-\d\d-\d\dT/.test(text) &&
    Number.isFinite(Date.parse(text));
  const caseKey = (text: unknown) =>
    typeof text === "string" && text.length > 0 && text.length <= 512 && !/[\x00-\x1f\x7f]/.test(text);
  if (
    Object.keys(item).some((key) => !allowed.has(key)) ||
    item.v !== 1 ||
    item.kind !== "canary.checkpoint" ||
    !identifier(item.runId) ||
    !pid(item.pid) ||
    !["running", "finalizing", "interrupted", "completed", "failed", "cancelled", "recovered"].includes(
      String(item.status),
    ) ||
    !timestamp(item.startedAt) ||
    !timestamp(item.updatedAt) ||
    !list(item.ports, 1024, (port) => Number.isSafeInteger(port) && Number(port) > 0 && Number(port) <= 65535) ||
    !list(item.childPids, 4096, (child) => pid(child) && Number(child) > 0) ||
    !list(item.completedCaseKeys, 10_000, caseKey) ||
    !list(item.pendingCaseKeys, 10_000, caseKey) ||
    (item.termination !== undefined &&
      !["timeout", "cancelled", "budget_exceeded", "error"].includes(String(item.termination))) ||
    (item.recoveryOf !== undefined && !identifier(item.recoveryOf)) ||
    (item.fault !== undefined &&
      !["RUN_LOCK_HELD", "STALE_LOCK", "DUPLICATE_RUN", "TMPDIR_CONFLICT", "PORT_CONFLICT"].includes(
        String(item.fault),
      ))
  )
    invalidCheckpoint();
  // Serialized paths never choose the recovery target.
  const expected = resolve(artifactDir);
  if (item.runId !== basename(expected))
    throw new RunRecoveryError("RUN_RECOVERY_PATH", "Checkpoint identity differs from its run directory.");
  for (const [field, path] of [
    ["artifactDir", expected],
    ["tmpDir", join(expected, "tmp")],
    ["workDir", join(expected, "work")],
    ["lockPath", join(expected, "run.lock")],
  ] as const) {
    if (typeof item[field] !== "string" || resolve(item[field]) !== path)
      throw new RunRecoveryError(
        "RUN_RECOVERY_PATH",
        "Checkpoint paths differ from the containing run directory; recovery was not started.",
      );
  }
  return item as unknown as RunCheckpoint;
}

export function writeCheckpoint(checkpoint: RunCheckpoint): void {
  validateCheckpoint(checkpoint, checkpoint.artifactDir);
  mkdirSync(checkpoint.artifactDir, { recursive: true });
  ordinaryDirectory(checkpoint.artifactDir);
  const file = checkpointPath(checkpoint.artifactDir);
  writePrivateJson(file, { ...checkpoint, updatedAt: new Date().toISOString() });
}

export function readCheckpoint(artifactDir: string): RunCheckpoint | undefined {
  ordinaryDirectory(artifactDir);
  const file = checkpointPath(artifactDir);
  if (!lstatSync(file, { throwIfNoEntry: false })) return undefined;
  try {
    return validateCheckpoint(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(boundedBytes(file))),
      artifactDir,
    );
  } catch (error) {
    if (error instanceof RunRecoveryError) throw error;
    return invalidCheckpoint();
  }
}

export function listCheckpoints(artifactRoot: string): RunCheckpoint[] {
  if (!existsSync(artifactRoot)) return [];
  ordinaryDirectory(artifactRoot);
  const root = resolve(artifactRoot);
  const entries = readdirSync(root, { withFileTypes: true });
  if (entries.length > 10_000) invalidCheckpoint();
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => readCheckpoint(join(root, entry.name)))
    .filter((item): item is RunCheckpoint => Boolean(item));
}

export function findCheckpointForPid(
  artifactRoot: string,
  pid: number,
  includeChildren = true,
): RunCheckpoint | undefined {
  const checkpoints = listCheckpoints(artifactRoot);
  return (
    checkpoints.find((item) => item.pid === pid) ??
    (includeChildren ? checkpoints.find((item) => item.childPids.includes(pid)) : undefined)
  );
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
  ordinaryDirectory(artifactDir);
  const dir = resolve(artifactDir);
  const current = readCheckpoint(dir);
  if (!current) invalidCheckpoint();
  if (snapshot && snapshot.runId !== current.runId) invalidCheckpoint();
  const integrity = verifyArtifacts(dir);
  if (integrity.status === "invalid") throw new ArtifactIntegrityError(integrity);
  if (
    integrity.status === "verified" ||
    (integrity.status !== "partial" && !["running", "finalizing", "interrupted"].includes(current.status))
  )
    throw new RunRecoveryError(
      "RUN_RECOVERY_FINALIZED",
      "Finalized run evidence is immutable; no recovery is required.",
    );
  if (current.pid > 0 && pidAlive(current.pid))
    throw new RunRecoveryError(
      "RUN_RECOVERY_LIVE_OWNER",
      "Run owner is still alive; wait for it to stop before recovering retained evidence.",
    );
  const childPids = [...new Set(current.childPids)];
  const leftoverPids = childPids.filter(pidAlive);
  if (leftoverPids.length)
    throw new RunRecoveryError(
      "RUN_RECOVERY_UNPROVEN_PROCESS",
      "Recorded worker PIDs are alive but ownership cannot be proven; inspect and stop the original workers before recovery. No process was terminated.",
    );
  for (const name of ["tmp", "work"]) {
    const target = join(dir, name),
      stat = lstatSync(target, { throwIfNoEntry: false });
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink()))
      throw new RunRecoveryError(
        "RUN_RECOVERY_PATH",
        "Recovery workspaces must be ordinary directories within the run.",
      );
  }
  const existingLock = lstatSync(join(dir, "run.lock"), { throwIfNoEntry: false });
  if (
    existingLock &&
    (!existingLock.isFile() || existingLock.isSymbolicLink() || existingLock.nlink !== 1 || existingLock.size > 4096)
  )
    invalidCheckpoint();
  acquireRunLock(join(dir, "run.lock"), {
    runId: current.runId,
    pid: process.pid,
    createdAt: new Date().toISOString(),
  });
  try {
    const lockedCheckpoint = readCheckpoint(dir),
      lockedIntegrity = verifyArtifacts(dir);
    if (
      JSON.stringify(lockedCheckpoint) !== JSON.stringify(current) ||
      lockedIntegrity.status !== integrity.status ||
      lockedIntegrity.manifestHash !== integrity.manifestHash
    )
      throw new RunRecoveryError(
        "RUN_RECOVERY_CHECKPOINT",
        "Run evidence changed before the recovery lock was acquired; inspect it before retrying.",
      );
    if (current.pid > 0 && pidAlive(current.pid))
      throw new RunRecoveryError(
        "RUN_RECOVERY_LIVE_OWNER",
        "Run owner became live before recovery; no retained evidence was revised.",
      );
    if (childPids.some(pidAlive))
      throw new RunRecoveryError(
        "RUN_RECOVERY_UNPROVEN_PROCESS",
        "A recorded PID became live before recovery; ownership is unproven and no process was terminated.",
      );
    const previousLineage = readArtifactManifest(dir)?.lineage;
    const startedAt = current?.startedAt ?? snapshot?.startedAt ?? new Date().toISOString();
    const runId = current?.runId ?? snapshot?.runId ?? dir.split(/[/\\]/).pop() ?? "unknown";
    // Persisted PIDs are observations, not ownership proof. Recovery never signals them.
    const killedPids: number[] = [];
    if (snapshot) {
      const recovered: RunSnapshot = {
        ...snapshot,
        status: snapshot.status === "running" || snapshot.status === "idle" ? "cancelled" : snapshot.status,
        finishedAt: snapshot.finishedAt ?? new Date().toISOString(),
        recoveryOf: runId,
        ...(snapshot.evidence
          ? {
              evidence: {
                ...snapshot.evidence,
                conclusionHash: undefined,
                lineage: { ...snapshot.evidence.lineage, ...previousLineage, recoveryOf: runId },
              },
            }
          : {}),
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
    reviseArtifacts(
      dir,
      () => {
        if (snapshot) writePrivateJson(join(dir, "run.json"), snapshot);
        const traceRepair = recoverTraceTail(dir);
        writePrivateJson(join(dir, "recovery.json"), {
          v: 1,
          kind: "canary.recovery",
          runId,
          recoveredAt: new Date().toISOString(),
          priorIntegrity: integrity.status,
          priorManifestHash: integrity.manifestHash,
          traceRepair,
          completedCaseKeys: checkpoint.completedCaseKeys,
          pendingCaseKeys: checkpoint.pendingCaseKeys,
          killedPids,
          leftoverPids,
        });
        writeCheckpoint(checkpoint);
      },
      { allowPartial: true, state: "recovered", lineage: snapshot?.evidence?.lineage ?? { recoveryOf: runId } },
    );
    return { checkpoint, snapshot, killedPids, leftoverPids };
  } finally {
    releaseRunLock(join(dir, "run.lock"));
  }
}

export async function recoverStaleRuns(
  artifactRoot: string,
  readSnapshot: (runId: string) => RunSnapshot | undefined,
): Promise<RecoveredRun[]> {
  const recovered: RecoveredRun[] = [];
  for (const checkpoint of listCheckpoints(artifactRoot)) {
    const liveOwner = checkpoint.pid > 0 && pidAlive(checkpoint.pid);
    const open =
      checkpoint.status === "running" ||
      checkpoint.status === "finalizing" ||
      checkpoint.status === "interrupted" ||
      verifyArtifacts(checkpoint.artifactDir).status === "partial";
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
