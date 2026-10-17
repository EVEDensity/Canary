import { randomUUID, createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  fstatSync,
  constants,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { archiveAuthorizationSchema } from "@canary/core";
import { containsSensitiveValue } from "./privacy.js";
import { performance } from "node:perf_hooks";

export class CollectionBusyError extends Error {
  readonly code = "COLLECTION_BUSY";
  constructor() {
    super("Evidence maintenance or a writer is active or interrupted; inspect the collection locks before retrying.");
  }
}
export function ordinaryCollectionPath(path: string): string {
  let current = resolve(path);
  while (true) {
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new CollectionBusyError();
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const absolute = resolve(path);
  return existsSync(absolute)
    ? realpathSync.native(absolute)
    : join(realpathSync.native(dirname(absolute)), basename(absolute));
}
const gatePath = (root: string) => `${resolve(root)}.maintenance.lock`;
function exclusive(file: string, retryMs = 0): () => void {
  let fd: number;
  const deadline = performance.now() + retryMs;
  while (true) {
    try {
      fd = openSync(file, "wx", 0o600);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || performance.now() >= deadline)
        throw new CollectionBusyError();
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
  const stat = fstatSync(fd);
  try {
    writeFileSync(fd, JSON.stringify({ pid: process.pid, nonce: randomUUID() }));
    fsyncSync(fd);
  } catch (error) {
    closeSync(fd);
    unlinkSync(file);
    throw error;
  }
  return () => {
    closeSync(fd);
    const now = lstatSync(file, { throwIfNoEntry: false });
    if (now?.dev === stat.dev && now.ino === stat.ino && !now.isSymbolicLink()) unlinkSync(file);
  };
}
/** A short enrollment barrier; independent executions retain distinct leases and can run concurrently. */
export function withCollectionMutation<T>(root: string, action: () => T): T {
  // Callers creating a new collection may not yet have its immediate parent.
  let parent = dirname(resolve(root));
  while (!existsSync(parent)) parent = dirname(parent);
  ordinaryCollectionPath(parent);
  mkdirSync(dirname(resolve(root)), { recursive: true });
  const canonical = ordinaryCollectionPath(root);
  if (existsSync(`${canonical}.maintenance-recovery.lock`)) throw new CollectionBusyError();
  const release = exclusive(gatePath(canonical), 200);
  try {
    if (existsSync(`${canonical}.maintenance-recovery.lock`)) throw new CollectionBusyError();
    return action();
  } finally {
    release();
  }
}
export function acquireCollectionLease(root: string): () => void {
  return withCollectionMutation(root, () => {
    mkdirSync(root, { recursive: true });
    ordinaryCollectionPath(root);
    return exclusive(join(root, `.operation_${randomUUID()}.lock`));
  });
}
function lockState(file: string) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 2048) throw new CollectionBusyError();
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let raw: Buffer;
  try {
    const opened = fstatSync(fd);
    if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size || opened.nlink !== 1)
      throw new CollectionBusyError();
    const bytes = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const amount = readSync(fd, bytes, length, bytes.length - length, null);
      if (!amount) break;
      length += amount;
    }
    if (length !== stat.size || fstatSync(fd).mtimeMs !== stat.mtimeMs) throw new CollectionBusyError();
    raw = bytes.subarray(0, length);
  } finally {
    closeSync(fd);
  }
  const value = JSON.parse(raw.toString("utf8"));
  if (
    Object.keys(value).length !== 2 ||
    !Number.isSafeInteger(value.pid) ||
    value.pid < 1 ||
    value.pid > 2147483647 ||
    typeof value.nonce !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.nonce)
  )
    throw new CollectionBusyError();
  let live = true;
  try {
    process.kill(value.pid, 0);
  } catch (error) {
    live = (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
  return { name: basename(file), hash: createHash("sha256").update(raw).digest("hex"), pid: value.pid as number, live };
}
export function inspectCollectionLocks(root: string) {
  ordinaryCollectionPath(root);
  const files = existsSync(root)
    ? readdirSync(root)
        .filter((name) => /^\.operation_[-a-f0-9]{36}\.lock$/.test(name))
        .map((name) => join(root, name))
    : [];
  if (existsSync(gatePath(root))) files.push(gatePath(root));
  if (files.length > 256 || existsSync(`${root}.maintenance-recovery.lock`)) throw new CollectionBusyError();
  const locks = files.sort().map(lockState);
  return { locks, hash: createHash("sha256").update(JSON.stringify(locks)).digest("hex") };
}
/** Explicit recovery only removes unchanged locks with absent owners; persisted PIDs never authorize signals. */
export function recoverCollectionLocks(root: string, expectedHash: string, actor: string, reason: string): void {
  const attribution = archiveAuthorizationSchema.parse({ planHash: expectedHash, actor, reason });
  if (containsSensitiveValue(attribution)) throw new CollectionBusyError();
  ordinaryCollectionPath(root);
  const releaseRecovery = exclusive(`${root}.maintenance-recovery.lock`);
  try {
    // Inspect without treating our own recovery guard as a foreign operation.
    const files = existsSync(root)
      ? readdirSync(root)
          .filter((n) => /^\.operation_[-a-f0-9]{36}\.lock$/.test(n))
          .map((n) => join(root, n))
      : [];
    if (existsSync(gatePath(root))) files.push(gatePath(root));
    if (files.length > 256) throw new CollectionBusyError();
    const locks = files.sort().map(lockState),
      hash = createHash("sha256").update(JSON.stringify(locks)).digest("hex");
    if (hash !== expectedHash || locks.some((item) => item.live)) throw new CollectionBusyError();
    const audit = `${root}.maintenance-recovered_${randomUUID()}.json`;
    writeFileSync(
      audit,
      JSON.stringify({ v: 1, kind: "canary.collection-recovery", at: new Date().toISOString(), actor, reason, locks }),
      { flag: "wx", mode: 0o600 },
    );
    for (const file of files) {
      const current = lockState(file);
      if (current.hash !== locks.find((item) => item.name === basename(file))?.hash || current.live)
        throw new CollectionBusyError();
      unlinkSync(file);
    }
  } finally {
    releaseRecovery();
  }
}
