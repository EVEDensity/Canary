import { createHash, randomUUID } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export class ExperienceStorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ExperienceStorageError";
  }
}

function errno(error: unknown): string | undefined { return (error as NodeJS.ErrnoException)?.code; }
const sleeper = new Int32Array(new SharedArrayBuffer(4));
function retryFilesystem<T>(fn: () => T): T {
  const deadline = Date.now() + 1_000;
  while (true) {
    try { return fn(); }
    catch (error) {
      // Windows can temporarily deny rename/unlink while another process has
      // the old file open for reading. Never fall back to truncating the target.
      if (process.platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes(errno(error) ?? "") || Date.now() >= deadline) throw error;
      Atomics.wait(sleeper, 0, 0, 10);
    }
  }
}
function remove(file: string): void {
  try { retryFilesystem(() => unlinkSync(file)); }
  catch (error) { if (errno(error) !== "ENOENT") throw error; }
}
export function readJson(file: string): unknown | undefined {
  let content: string;
  try { content = readFileSync(file, "utf8"); }
  catch (error) {
    if (errno(error) === "ENOENT") return undefined;
    throw new ExperienceStorageError(`Cannot read experience storage: ${file}`, { cause: error });
  }
  try { return JSON.parse(content.replace(/^\uFEFF/, "")); }
  catch (error) { throw new ExperienceStorageError(`Corrupt experience JSON: ${file}; restore or repair it before continuing`, { cause: error }); }
}

function syncDirectory(dir: string): void {
  let fd: number | undefined;
  try { fd = openSync(dir, "r"); fsyncSync(fd); }
  catch (error) {
    // Windows does not expose directory fsync through Node. File fsync and rename
    // remain mandatory; on platforms that support it, directory sync is mandatory too.
    if (process.platform !== "win32" || !["EISDIR", "EPERM", "EACCES", "EINVAL", "ENOTSUP", "EBADF"].includes(errno(error) ?? "")) throw error;
  } finally { if (fd !== undefined) closeSync(fd); }
}

function atomicWrite(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  let fd: number | undefined;
  try {
    fd = openSync(tmp, "wx", 0o600);
    writeFileSync(fd, JSON.stringify(value, null, 2), "utf8");
    fsyncSync(fd);
    closeSync(fd); fd = undefined;
    retryFilesystem(() => renameSync(tmp, file));
    syncDirectory(dirname(file));
  } finally {
    if (fd !== undefined) closeSync(fd);
    remove(tmp);
  }
}

interface Ticket { v: 1; pid: number; token: string; choosing: boolean; ticket: number }
export interface StorageWrite { file: string; value: unknown }
interface Journal { v: 1; writes: StorageWrite[]; hash: string }
const TICKET_NAME = /^[0-9]+-[a-f0-9-]{36}\.json$/;
const RECORD_PATH = /^records\/[A-Za-z0-9][A-Za-z0-9_.-]{0,159}\.json$/;
function checksum(writes: StorageWrite[]): string { return createHash("sha256").update(JSON.stringify(writes)).digest("hex"); }
function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (errno(error) === "ESRCH") return false; if (errno(error) === "EPERM") return true; throw error; }
}

/** Synchronous, process-shared locking and redo journal for the existing file store. */
export class ExperienceStorage {
  private readonly locksDir: string;
  private readonly journalFile: string;
  constructor(private readonly rootDir: string, private readonly validateWrite: (write: StorageWrite) => void) {
    this.locksDir = resolve(rootDir, ".write-locks");
    this.journalFile = resolve(rootDir, "transaction.json");
    mkdirSync(this.locksDir, { recursive: true });
  }

  private tickets(): Array<Ticket & { file: string }> {
    const result: Array<Ticket & { file: string }> = [];
    for (const name of readdirSync(this.locksDir)) {
      if (!name.endsWith(".json")) continue;
      const file = resolve(this.locksDir, name);
      const value = readJson(file);
      if (value === undefined) continue; // An owner can finish between listing and reading.
      if (!TICKET_NAME.test(name) || !object(value) || value.v !== 1 || !Number.isSafeInteger(value.pid) || (value.pid as number) <= 0 || typeof value.token !== "string" || name !== `${value.pid}-${value.token}.json` || typeof value.choosing !== "boolean" || !Number.isSafeInteger(value.ticket) || (value.ticket as number) < 0 || (value.choosing ? value.ticket !== 0 : value.ticket === 0)) {
        throw new ExperienceStorageError(`Corrupt experience lock: ${file}; repair it before continuing`);
      }
      if (alive(value.pid as number)) result.push({ ...(value as unknown as Ticket), file });
      // Each ticket has a unique filename, so dead-owner cleanup cannot delete a
      // newly acquired lock. Never steal a lock based on its age.
      else remove(file);
    }
    return result;
  }

  locked<T>(fn: () => T): T {
    const token = randomUUID();
    const file = resolve(this.locksDir, `${process.pid}-${token}.json`);
    const owner: Ticket = { v: 1, pid: process.pid, token, choosing: true, ticket: 0 };
    try {
      atomicWrite(file, owner);
      // Lamport's bakery protocol makes reclamation safe without an unsafe
      // read/unlink race on a single shared lock file. All entrants first publish
      // choosing=true, then wait for every earlier ticket (UUID breaks ties).
      owner.ticket = Math.max(0, ...this.tickets().map((ticket) => ticket.ticket)) + 1;
      if (!Number.isSafeInteger(owner.ticket)) throw new ExperienceStorageError("Experience lock ticket overflow");
      owner.choosing = false;
      atomicWrite(file, owner);
      const deadline = Date.now() + 10_000;
      while (this.tickets().some((other) => other.token !== token && (other.choosing || other.ticket < owner.ticket || (other.ticket === owner.ticket && other.token < token)))) {
        if (Date.now() >= deadline) throw new ExperienceStorageError("Experience storage lock is busy; a live owner still holds it. Retry after that operation finishes");
        Atomics.wait(sleeper, 0, 0, 10);
      }
      this.recover();
      return fn();
    } finally { remove(file); }
  }

  private checkedWrites(value: unknown): StorageWrite[] {
    if (!object(value) || value.v !== 1 || !Array.isArray(value.writes) || !value.writes.length || typeof value.hash !== "string") throw new ExperienceStorageError("Corrupt experience transaction journal; restore or repair it before continuing");
    const seen = new Set<string>();
    for (const write of value.writes) {
      if (!object(write) || typeof write.file !== "string" || (write.file !== "active.json" && !RECORD_PATH.test(write.file)) || seen.has(write.file) || !object(write.value)) throw new ExperienceStorageError("Corrupt experience transaction entry; restore or repair the journal before continuing");
      seen.add(write.file);
      this.validateWrite(write as unknown as StorageWrite);
    }
    const writes = value.writes as StorageWrite[];
    if (checksum(writes) !== value.hash) throw new ExperienceStorageError("Corrupt experience transaction checksum; restore or repair the journal before continuing");
    return writes;
  }

  private recover(): void {
    const journal = readJson(this.journalFile);
    if (journal === undefined) return;
    // Validate the entire plan before changing any file. Replay is idempotent.
    const writes = this.checkedWrites(journal);
    for (const write of writes) atomicWrite(resolve(this.rootDir, write.file), write.value);
    remove(this.journalFile);
    syncDirectory(this.rootDir);
  }

  /** Caller must hold locked(). The journal rename is the transaction commit point. */
  commit(writes: StorageWrite[]): void {
    if (!writes.length) return;
    const journal: Journal = { v: 1, writes, hash: checksum(writes) };
    this.checkedWrites(journal);
    atomicWrite(this.journalFile, journal);
    this.recover();
  }
}
