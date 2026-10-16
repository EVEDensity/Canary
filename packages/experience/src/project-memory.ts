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
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  PROJECT_MEMORY_MAX_RECORD_BYTES,
  PROJECT_MEMORY_MAX_RECORDS,
  PROJECT_MEMORY_MAX_STORE_BYTES,
  parseProjectMemoryRecord,
  projectMemoryHash,
  projectMemoryId,
  type ProjectMemoryInput,
  type ProjectMemoryRecord,
} from "@canary/core";
import { ExperienceStorage, ExperienceStorageError, type StorageWrite } from "./storage.js";

const recordName = /^memory_[a-f0-9]{24}\.json$/;
const ticketName = /^[0-9]+-[a-f0-9-]{36}\.json$/;
const uuid = "[a-f0-9-]{36}";
const temporary = new RegExp(
  `^(?:transaction\\.json|memory_[a-f0-9]{24}\\.json|[0-9]+-${uuid}\\.json)\\.${uuid}\\.tmp$`,
);
const digest = /^[a-f0-9]{64}$/;
function fail(message: string): never {
  throw new ExperienceStorageError(`Project memory: ${message}`);
}

/** Facts are separate from active experiences and never grant execution authority. */
export class ProjectMemoryStore {
  readonly rootDir: string;
  readonly projectId: string;
  constructor(rootDir: string, projectId: string) {
    if (!digest.test(projectId)) fail("a project identity digest is required");
    this.rootDir = resolve(rootDir);
    this.projectId = projectId;
    this.assertParents();
    this.layout();
  }
  private assertParents(): void {
    let current = this.rootDir;
    while (true) {
      const stat = lstatSync(current, { throwIfNoEntry: false });
      if (stat) {
        if (!stat.isDirectory() || stat.isSymbolicLink()) fail("storage parents must be ordinary directories");
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  private layout(): { records: string[]; pending: boolean; locks: string[]; bytes: number } {
    this.assertParents();
    if (!existsSync(this.rootDir)) return { records: [], pending: false, locks: [], bytes: 0 };
    let bytes = 0,
      entries = 0,
      pending = false;
    const records: string[] = [];
    const locks: string[] = [];
    const scan = (dir: string, section: "root" | "records" | "locks") => {
      for (const name of readdirSync(dir)) {
        if (++entries > 2048) fail("storage entry budget exceeded");
        const file = join(dir, name),
          stat = lstatSync(file, { throwIfNoEntry: false });
        // Other writers atomically publish temporary files and retire tickets.
        // Those operational entries may disappear between listing and lstat.
        if (!stat) {
          if (temporary.test(name) || (section === "locks" && ticketName.test(name))) continue;
          fail("storage changed during inspection; retry after the writer finishes");
        }
        if (stat.isSymbolicLink()) fail("symbolic links and junctions are not supported");
        if (section === "root" && ["records", ".write-locks"].includes(name)) {
          if (!stat.isDirectory()) fail("storage directories are invalid");
          scan(file, name === "records" ? "records" : "locks");
          continue;
        }
        if (!stat.isFile() || stat.nlink !== 1) fail("storage entries must be ordinary, unshared files");
        bytes += stat.size;
        if (bytes > PROJECT_MEMORY_MAX_STORE_BYTES) fail("storage byte budget exceeded");
        if (section === "records" && recordName.test(name)) {
          if (stat.size > PROJECT_MEMORY_MAX_RECORD_BYTES) fail("record byte budget exceeded");
          records.push(name);
        } else if (section === "root" && name === "transaction.json") {
          if (stat.size > PROJECT_MEMORY_MAX_RECORD_BYTES * 2 + 4096) fail("transaction byte budget exceeded");
          pending = true;
        } else if (section === "locks" && ticketName.test(name)) {
          if (stat.size > 1024) fail("lock byte budget exceeded");
          locks.push(name);
        } else if (temporary.test(name)) {
          if (stat.size > PROJECT_MEMORY_MAX_RECORD_BYTES * 2 + 4096) fail("temporary byte budget exceeded");
        } else fail("an unknown storage entry must be reviewed before continuing");
      }
    };
    scan(this.rootDir, "root");
    if (records.length > PROJECT_MEMORY_MAX_RECORDS) fail("record count budget exceeded");
    return { records: records.sort(), pending, locks, bytes };
  }
  private checked(value: unknown, name?: string): ProjectMemoryRecord {
    let record: ProjectMemoryRecord;
    try {
      record = parseProjectMemoryRecord(value);
    } catch {
      return fail("a record is corrupt, incomplete or outside the supported schema");
    }
    if (record.projectId !== this.projectId) fail("record belongs to another project");
    if (name && name !== `${record.id}.json`) fail("record filename does not match its identity");
    return record;
  }
  private readDocument(name: string): string {
    if (!recordName.test(name)) fail("invalid record filename");
    this.assertParents();
    const file = join(this.rootDir, "records", name),
      before = lstatSync(file);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1)
      fail("record must be an ordinary, unshared file");
    const descriptor = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = fstatSync(descriptor);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > PROJECT_MEMORY_MAX_RECORD_BYTES)
        fail("record byte budget or file identity is invalid");
      const bytes = Buffer.alloc(PROJECT_MEMORY_MAX_RECORD_BYTES + 1);
      let length = 0;
      while (length < bytes.length) {
        const read = readSync(descriptor, bytes, length, bytes.length - length, null);
        if (!read) break;
        length += read;
      }
      if (length > PROJECT_MEMORY_MAX_RECORD_BYTES) fail("record byte budget exceeded");
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length));
    } finally {
      closeSync(descriptor);
    }
  }
  private checkedWrite(write: StorageWrite): void {
    this.layout();
    if (!/^records\/memory_[a-f0-9]{24}\.json$/.test(write.file))
      fail("transaction target is outside the memory records");
    this.checked(write.value, write.file.slice("records/".length));
    if (Buffer.byteLength(JSON.stringify(write.value, null, 2)) > PROJECT_MEMORY_MAX_RECORD_BYTES)
      fail("record byte budget exceeded");
    const files = readdirSync(join(this.rootDir, "records")).filter((name) => recordName.test(name));
    if (!files.includes(write.file.slice("records/".length)) && files.length >= PROJECT_MEMORY_MAX_RECORDS)
      fail("record count budget exceeded");
  }
  private storage(): ExperienceStorage {
    this.assertParents();
    mkdirSync(join(this.rootDir, "records"), { recursive: true });
    this.layout();
    return new ExperienceStorage(this.rootDir, (write) => this.checkedWrite(write));
  }
  private listUnlocked(): ProjectMemoryRecord[] {
    return this.layout()
      .records.map((name) => {
        let value: unknown;
        try {
          value = JSON.parse(this.readDocument(name));
        } catch {
          return fail("record JSON is corrupt or incomplete");
        }
        return this.checked(value, name);
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  }
  private commitRecord(storage: ExperienceStorage, record: ProjectMemoryRecord): void {
    const write = { file: `records/${record.id}.json`, value: record };
    const recordBytes = Buffer.byteLength(JSON.stringify(record, null, 2));
    const journalBytes = Buffer.byteLength(JSON.stringify({ v: 1, writes: [write], hash: "0".repeat(64) }, null, 2));
    // The old record, committed redo journal and replacement temporary coexist.
    // Reject before publishing a journal that our own recovery could not read.
    if (this.layout().bytes + journalBytes + recordBytes > PROJECT_MEMORY_MAX_STORE_BYTES)
      fail("transaction requires more storage headroom before writing");
    storage.commit([write]);
  }
  list(): ProjectMemoryRecord[] {
    const layout = this.layout();
    const readable = (snapshot: ReturnType<ProjectMemoryStore["layout"]>) => {
      if (snapshot.pending) fail("a pending transaction requires record or revoke to recover before reading");
      if (snapshot.locks.length) fail("storage is busy; retry after the writer finishes");
    };
    readable(layout);
    if (!layout.records.length) return [];
    // Reads never replay a journal or mutate memory state. Check both the
    // publication boundary and exact record bytes across this bounded snapshot.
    const documents = layout.records.map((name) => ({
      name,
      bytes: this.readDocument(name),
    }));
    const records = documents.map(({ name, bytes }) => {
      let value: unknown;
      try {
        value = JSON.parse(bytes);
      } catch {
        return fail("record JSON is corrupt or incomplete");
      }
      return this.checked(value, name);
    });
    const after = this.layout();
    readable(after);
    if (
      JSON.stringify(after.records) !== JSON.stringify(layout.records) ||
      documents.some(({ name, bytes }) => this.readDocument(name) !== bytes)
    )
      fail("storage changed during reading; retry the query");
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  }
  record(input: ProjectMemoryInput): ProjectMemoryRecord {
    const raw = {
      ...input,
      id: projectMemoryId(input.projectId, input.source.receiptHash),
      status: "retained" as const,
    };
    const record = this.checked({ ...raw, contentHash: projectMemoryHash(raw) });
    const storage = this.storage();
    return storage.locked(() => {
      const records = this.listUnlocked();
      const existing = records.find((value) => value.id === record.id);
      if (existing) return existing;
      if (records.length >= PROJECT_MEMORY_MAX_RECORDS) fail("record count budget exceeded");
      this.commitRecord(storage, record);
      return record;
    });
  }
  revoke(id: string, actor: string, reason: string): ProjectMemoryRecord {
    if (!/^memory_[a-f0-9]{24}$/.test(id)) fail("invalid record identity");
    const layout = this.layout();
    if (!layout.records.length && !layout.pending) fail("record was not found");
    const storage = this.storage();
    return storage.locked(() => {
      const record = this.listUnlocked().find((value) => value.id === id);
      if (!record) return fail("record was not found");
      const raw = {
        ...record,
        status: "revoked" as const,
        revocation: { at: new Date().toISOString(), actor, reason },
      };
      const updated = this.checked({ ...raw, contentHash: projectMemoryHash(raw) });
      if (record.status === "revoked") return record;
      this.commitRecord(storage, updated);
      return updated;
    });
  }
}
