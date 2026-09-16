import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pidAlive, reclaimOrphans } from "@canary/isolation";

export type IsolationFaultCode =
  | "RUN_LOCK_HELD"
  | "STALE_LOCK"
  | "DUPLICATE_RUN"
  | "TMPDIR_CONFLICT"
  | "PORT_CONFLICT";

export class RunIsolationError extends Error {
  constructor(
    readonly code: IsolationFaultCode,
    message: string,
    readonly suggestion: string,
  ) {
    super(message);
    this.name = "RunIsolationError";
  }
}

export interface LockRecord {
  runId: string;
  pid: number;
  createdAt: string;
}

export interface PortLease {
  port: number;
  host: string;
  release(): Promise<void>;
}

export interface ExecutionWorkspace {
  runId: string;
  artifactDir: string;
  tmpDir: string;
  workDir: string;
  lockPath: string;
  env: NodeJS.ProcessEnv;
  ports: number[];
  childPids: number[];
  release(): Promise<void>;
  recordChildPid(pid: number): void;
  reservePort(preferred?: number): Promise<PortLease>;
}

function lockRecord(file: string): LockRecord | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as LockRecord;
  } catch {
    return undefined;
  }
}

export function assertExclusiveTempDir(tmpDir: string, runId: string): void {
  const ownerFile = join(tmpDir, ".owner.json");
  if (!existsSync(ownerFile)) return;
  try {
    const owner = JSON.parse(readFileSync(ownerFile, "utf8")) as { runId?: string; pid?: number };
    if (owner.runId && owner.runId !== runId && typeof owner.pid === "number" && pidAlive(owner.pid)) {
      throw new RunIsolationError(
        "TMPDIR_CONFLICT",
        `Temporary directory is owned by live run ${owner.runId} (pid ${owner.pid}).`,
        "Use a distinct runId so concurrent runs keep separate tmp/work/lock directories.",
      );
    }
  } catch (error) {
    if (error instanceof RunIsolationError) throw error;
  }
}

export function isolatedEnv(
  tmpDir: string,
  extras: Record<string, string | undefined> = {},
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  env.TMPDIR = tmpDir;
  env.TEMP = tmpDir;
  env.TMP = tmpDir;
  env.CANARY_TMPDIR = tmpDir;
  for (const [key, value] of Object.entries(extras)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

export function acquireRunLock(lockPath: string, record: LockRecord): { stale: boolean } {
  mkdirSync(resolve(lockPath, ".."), { recursive: true });
  try {
    const fd = openSync(lockPath, "wx");
    try {
      writeFileSync(fd, JSON.stringify(record, null, 2), "utf8");
    } finally {
      closeSync(fd);
    }
    return { stale: false };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") throw error;
    const existing = lockRecord(lockPath);
    if (existing && pidAlive(existing.pid)) {
      throw new RunIsolationError(
        existing.runId === record.runId ? "DUPLICATE_RUN" : "RUN_LOCK_HELD",
        `Run lock is held by live pid ${existing.pid} for ${existing.runId}.`,
        "Wait for the other run to finish, or recover only after that process has exited; do not delete sibling artifacts.",
      );
    }
    try {
      unlinkSync(lockPath);
    } catch {
      /* another recoverer may have removed it */
    }
    const fd = openSync(lockPath, "wx");
    try {
      writeFileSync(fd, JSON.stringify({ ...record, recoveredFrom: existing?.pid }, null, 2), "utf8");
    } finally {
      closeSync(fd);
    }
    return { stale: true };
  }
}

export function releaseRunLock(lockPath: string, pid = process.pid): void {
  const existing = existsSync(lockPath) ? lockRecord(lockPath) : undefined;
  if (existing && existing.pid !== pid && pidAlive(existing.pid)) return;
  try {
    unlinkSync(lockPath);
  } catch {
    /* already released */
  }
}

export async function reservePort(host = "127.0.0.1", preferred?: number): Promise<PortLease> {
  return await new Promise<PortLease>((resolvePromise, rejectPromise) => {
    const server = createServer();
    server.once("error", (error) => {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EADDRINUSE") {
        rejectPromise(
          new RunIsolationError(
            "PORT_CONFLICT",
            `Port ${preferred ?? "auto"} on ${host} is already in use.`,
            "Let Canary allocate an ephemeral loopback port, or stop the process holding the requested port.",
          ),
        );
        return;
      }
      rejectPromise(error);
    });
    server.listen(preferred ?? 0, host, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolvePromise({
        port,
        host,
        release: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            server.close((closeError) => (closeError ? rejectClose(closeError) : resolveClose()));
          }),
      });
    });
  });
}

export function createExecutionWorkspace(input: {
  artifactDir: string;
  runId: string;
  extraEnv?: Record<string, string | undefined>;
}): ExecutionWorkspace {
  const artifactDir = resolve(input.artifactDir);
  const tmpDir = join(artifactDir, "tmp");
  const workDir = join(artifactDir, "work");
  const lockPath = join(artifactDir, "run.lock");
  mkdirSync(artifactDir, { recursive: true });
  acquireRunLock(lockPath, { runId: input.runId, pid: process.pid, createdAt: new Date().toISOString() });
  if (existsSync(tmpDir)) {
    try {
      assertExclusiveTempDir(tmpDir, input.runId);
    } catch (error) {
      releaseRunLock(lockPath);
      throw error;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  }
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(workDir, { recursive: true });
  writeFileSync(join(tmpDir, ".owner.json"), JSON.stringify({ runId: input.runId, pid: process.pid }, null, 2), "utf8");
  const leases: PortLease[] = [];
  const childPids: number[] = [];
  const env = isolatedEnv(tmpDir, { CANARY_RUN_ID: input.runId, CANARY_WORKDIR: workDir, ...input.extraEnv });
  return {
    runId: input.runId,
    artifactDir,
    tmpDir,
    workDir,
    lockPath,
    env,
    ports: [],
    childPids,
    recordChildPid(pid: number) {
      if (pid && !childPids.includes(pid)) childPids.push(pid);
    },
    async reservePort(preferred?: number) {
      const lease = await reservePort("127.0.0.1", preferred);
      leases.push(lease);
      this.ports.push(lease.port);
      return lease;
    },
    async release() {
      const leftover = await reclaimOrphans(childPids);
      childPids.splice(0, childPids.length, ...leftover);
      for (const lease of leases.splice(0)) {
        try {
          await lease.release();
        } catch {
          /* keep evidence; port may already be closed */
        }
      }
      releaseRunLock(lockPath);
    },
  };
}

export function defaultTmpRoot(): string {
  return process.env.CANARY_TMPDIR || tmpdir();
}
