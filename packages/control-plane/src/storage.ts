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
import { dirname, relative, resolve, sep } from "node:path";

export class ControlError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export function assert(condition: unknown, message: string, status = 409): asserts condition {
  if (!condition) throw new ControlError(status, message);
}
export function safeId(value: unknown): string {
  assert(
    typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,159}$/.test(value) && value !== "." && value !== "..",
    "Invalid identifier",
    400,
  );
  return value;
}
export function hash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value) ?? "null")
    .digest("hex");
}
/** Deny symlinks/junctions even when they currently point inside the project. */
export function guarded(root: string, ...parts: string[]): string {
  root = resolve(root);
  const target = resolve(root, ...parts);
  const rel = relative(root, target);
  assert(
    rel !== ".." && !rel.startsWith(`..${sep}`) && !resolve(root, rel).startsWith(`${root}${sep}..`),
    "Path escapes project",
    400,
  );
  assert(target === root || target.startsWith(root + sep), "Path escapes project", 400);
  let cursor = root;
  for (const component of ["", ...rel.split(sep).filter(Boolean)]) {
    if (component) cursor = resolve(cursor, component);
    const stat = lstatSync(cursor, { throwIfNoEntry: false });
    if (stat)
      assert(!stat.isSymbolicLink() && (!stat.isFile() || stat.nlink === 1), "Linked evidence path refused", 409);
  }
  return target;
}
export function read<T>(file: string): T | undefined {
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, "")) as T;
  } catch {
    throw new ControlError(409, "Corrupt evidence; repair or restore before continuing");
  }
}
export function atomic(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  const fd = openSync(tmp, "wx", 0o600);
  try {
    writeFileSync(fd, JSON.stringify(data, null, 2), "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, file);
}
export function names(root: string, dir: string, directories = false): string[] {
  const path = guarded(root, dir);
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((e) => (directories ? e.isDirectory() : e.isFile() && e.name.endsWith(".json")))
    .map((e) => e.name)
    .sort();
}
export function locked<T>(root: string, fn: () => T): T {
  const dir = guarded(root, ".canary/control-plane");
  mkdirSync(dir, { recursive: true });
  const lock = guarded(root, ".canary/control-plane/write.lock");
  let fd: number;
  try {
    fd = openSync(lock, "wx", 0o600);
  } catch {
    throw new ControlError(
      409,
      "Control write lock held; after a crash reconcile pending audit before removing stale lock",
    );
  }
  try {
    writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    return fn();
  } finally {
    closeSync(fd);
    unlinkSync(lock);
  }
}
