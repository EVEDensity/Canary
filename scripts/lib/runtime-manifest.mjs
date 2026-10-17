import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readlinkSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const MANIFEST = ".canary-runtime.json";
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_FILES = 30000;
const MAX_RUNTIME_BYTES = 1024 * 1024 * 1024;
const TREES = ["packages", "apps/web", "scripts", "node_modules", "integrations/skills/canary-verify"];
const ROOT_FILES = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json"];
const HASH = /^[a-f0-9]{64}$/;
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (message) => {
  throw new Error(`Runtime integrity check failed: ${message}`);
};
function optionalStat(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}
function inside(root, path) {
  const result = relative(root, path);
  return !isAbsolute(result) && result !== ".." && !result.startsWith("../") && !result.startsWith("..\\");
}
function safePath(value, allowRoot = false) {
  return (
    typeof value === "string" &&
    ((allowRoot && value === ".") ||
      (value.length > 0 &&
        !/[\\:\x00-\x1f\x7f]/.test(value) &&
        value.split("/").every((part) => part !== "" && part !== "." && part !== "..")))
  );
}
function identity(stat) {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
}
function fileHash(path, before, buffer) {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || identity(opened) !== identity(before)) fail("file changed during verification");
    const hash = createHash("sha256");
    let length,
      size = 0;
    while ((length = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      size += length;
      if (size > before.size || size > MAX_RUNTIME_BYTES) fail("file changed during verification");
      hash.update(buffer.subarray(0, length));
    }
    if (
      size !== before.size ||
      identity(fstatSync(fd)) !== identity(before) ||
      identity(lstatSync(path)) !== identity(before)
    )
      fail("file changed during verification");
    return hash.digest("hex");
  } finally {
    closeSync(fd);
  }
}
function packageName(packageId) {
  const base = packageId.split("(")[0],
    separator = base.indexOf("@", base.startsWith("@") ? 1 : 0),
    name = base.slice(0, separator).replace("+", "/");
  return separator > 0 && safePath(name) ? name : undefined;
}
function optionalNames(root, packageFile, context) {
  if (context.cache.has(packageFile)) return context.cache.get(packageFile);
  let names = [];
  try {
    const stat = lstatSync(packageFile);
    if (
      stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.size <= MAX_MANIFEST_BYTES &&
      inside(root, realpathSync.native(packageFile))
    ) {
      context.bytes += stat.size;
      if (context.bytes > 16 * 1024 * 1024) fail("optional dependency metadata limit exceeded");
      const owner = JSON.parse(readFileSync(packageFile, "utf8"));
      if (
        owner.optionalDependencies &&
        typeof owner.optionalDependencies === "object" &&
        !Array.isArray(owner.optionalDependencies)
      )
        names = Object.keys(owner.optionalDependencies).filter(
          (name) => typeof owner.optionalDependencies[name] === "string",
        );
    }
  } catch (error) {
    if (error.message?.includes("optional dependency metadata limit")) throw error;
    // An absent or invalid owner never authorizes a missing dependency link.
  }
  context.cache.set(packageFile, names);
  return names;
}
function declaredOptionalLink(root, relativePath, context) {
  const parts = relativePath.split("/"),
    virtual = parts.lastIndexOf(".pnpm");
  let ownerRoot, dependency;
  if (virtual > 0 && parts[virtual - 1] === "node_modules" && parts[virtual + 1] === "node_modules") {
    dependency = parts.slice(virtual + 2).join("/");
    if (!/^(?:@[^/]+\/)?[^/]+$/.test(dependency)) return false;
    const store = join(root, ...parts.slice(0, virtual + 1));
    // pnpm may retain hoisted aliases for optional packages omitted on this platform.
    for (const owner of readdirSync(store).sort(compare)) {
      const name = packageName(owner);
      if (
        name &&
        optionalNames(root, join(store, owner, "node_modules", name, "package.json"), context).includes(dependency)
      )
        return true;
    }
    return false;
  } else if (virtual > 0 && parts[virtual - 1] === "node_modules" && parts[virtual + 2] === "node_modules") {
    const name = packageName(parts[virtual + 1]);
    if (!name) return false;
    ownerRoot = join(root, ...parts.slice(0, virtual + 3), name);
    dependency = parts.slice(virtual + 3).join("/");
  } else {
    const moduleIndex = parts.lastIndexOf("node_modules");
    if (moduleIndex < 0) return false;
    ownerRoot = join(root, ...parts.slice(0, moduleIndex));
    dependency = parts.slice(moduleIndex + 1).join("/");
  }
  if (!/^(?:@[^/]+\/)?[^/]+$/.test(dependency)) return false;
  return optionalNames(root, join(ownerRoot, "package.json"), context).includes(dependency);
}
function missingOptionalTarget(root, relativePath, rawTarget, context) {
  if (!declaredOptionalLink(root, relativePath, context)) fail(`broken or cyclic runtime link: ${relativePath}`);
  const lexical = resolve(dirname(join(root, relativePath)), rawTarget);
  if (!inside(root, lexical)) fail("runtime link leaves the installation");
  let parent = dirname(lexical);
  while (!optionalStat(parent)) {
    const next = dirname(parent);
    if (parent === next || !inside(root, next)) fail("runtime link leaves the installation");
    parent = next;
  }
  try {
    if (!inside(root, realpathSync.native(parent))) fail("runtime link leaves the installation");
  } catch {
    fail("runtime link parent is broken or external");
  }
  return relative(root, lexical).replaceAll("\\", "/") || ".";
}
function scan(root) {
  const entries = [],
    optional = { cache: new Map(), bytes: 0 },
    buffer = Buffer.allocUnsafe(1024 * 1024);
  let bytes = 0;
  const visit = (relativePath) => {
    if (!safePath(relativePath)) fail("unsupported runtime path");
    const path = join(root, relativePath),
      stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      const rawTarget = readlinkSync(path);
      let resolved,
        missing = false;
      try {
        resolved = realpathSync.native(path);
      } catch (error) {
        if (error.code !== "ENOENT") fail(`broken or cyclic runtime link: ${relativePath}`);
        resolved = join(root, missingOptionalTarget(root, relativePath, rawTarget, optional));
        missing = true;
      }
      if (!inside(root, resolved)) fail("runtime link leaves the installation");
      const target = relative(root, resolved).replaceAll("\\", "/") || ".";
      if (!safePath(target, true) || readlinkSync(path) !== rawTarget || identity(lstatSync(path)) !== identity(stat))
        fail("runtime link changed during verification");
      entries.push({ type: "link", path: relativePath, target, ...(missing ? { state: "missing" } : {}) });
    } else if (stat.isDirectory()) {
      if (!inside(root, realpathSync.native(path))) fail("runtime directory leaves the installation");
      for (const name of readdirSync(path).sort(compare)) visit(`${relativePath}/${name}`);
      if (identity(lstatSync(path)) !== identity(stat)) fail("runtime directory changed during verification");
    } else if (stat.isFile()) {
      bytes += stat.size;
      if (!Number.isSafeInteger(bytes) || bytes > MAX_RUNTIME_BYTES) fail("runtime byte limit exceeded");
      entries.push({ type: "file", path: relativePath, size: stat.size, sha256: fileHash(path, stat, buffer) });
    } else fail("unsupported runtime file type");
    if (entries.length > MAX_FILES) fail("runtime file limit exceeded");
  };
  for (const path of [...TREES, ...ROOT_FILES]) if (optionalStat(join(root, path))) visit(path);
  for (const required of ["packages/cli/package.json", "packages/cli/dist/index.js"])
    if (!entries.some((entry) => entry.path === required && entry.type === "file")) fail("CLI runtime is missing");
  entries.sort((a, b) => compare(a.path, b.path));
  return { v: 1, kind: "canary.runtime-manifest", entries };
}
function summary(manifest) {
  return {
    runtimeManifestHash: sha256(JSON.stringify(manifest)),
    runtimeFileCount: manifest.entries.length,
    runtimeBytes: manifest.entries.reduce((size, entry) => size + (entry.type === "file" ? entry.size : 0), 0),
    runtimeMissingLinkCount: manifest.entries.filter((entry) => entry.type === "link" && entry.state === "missing")
      .length,
  };
}
function exactKeys(value, keys) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join() === keys.sort().join()
  );
}
function parseManifest(bytes) {
  if (bytes.length > MAX_MANIFEST_BYTES) fail("manifest byte limit exceeded");
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("manifest is not valid JSON");
  }
  if (
    !exactKeys(manifest, ["v", "kind", "entries"]) ||
    manifest.v !== 1 ||
    manifest.kind !== "canary.runtime-manifest" ||
    !Array.isArray(manifest.entries) ||
    !manifest.entries.length ||
    manifest.entries.length > MAX_FILES
  )
    fail("manifest schema is invalid");
  let prior = "",
    total = 0;
  for (const entry of manifest.entries) {
    if (
      !safePath(entry?.path) ||
      compare(entry.path, prior) <= 0 ||
      ![...TREES, ...ROOT_FILES].some(
        (selected) => entry.path === selected || (TREES.includes(selected) && entry.path.startsWith(selected + "/")),
      )
    )
      fail("manifest path or ordering is invalid");
    prior = entry.path;
    if (entry.type === "file") {
      if (
        !exactKeys(entry, ["type", "path", "size", "sha256"]) ||
        !Number.isSafeInteger(entry.size) ||
        entry.size < 0 ||
        typeof entry.sha256 !== "string" ||
        !HASH.test(entry.sha256)
      )
        fail("manifest file entry is invalid");
      total += entry.size;
      if (!Number.isSafeInteger(total) || total > MAX_RUNTIME_BYTES) fail("runtime byte limit exceeded");
    } else if (entry.type === "link") {
      if (
        !(
          exactKeys(entry, ["type", "path", "target"]) ||
          (exactKeys(entry, ["type", "path", "target", "state"]) && entry.state === "missing")
        ) ||
        !safePath(entry.target, true)
      )
        fail("manifest link entry is invalid");
    } else fail("manifest entry type is invalid");
  }
  // Normalize object key order; only canonical content contributes to the bound hash.
  return {
    v: 1,
    kind: "canary.runtime-manifest",
    entries: manifest.entries.map((entry) =>
      entry.type === "file"
        ? { type: "file", path: entry.path, size: entry.size, sha256: entry.sha256 }
        : {
            type: "link",
            path: entry.path,
            target: entry.target,
            ...(entry.state === "missing" ? { state: "missing" } : {}),
          },
    ),
  };
}
function canonicalRoot(root) {
  const result = realpathSync.native(root);
  if (!lstatSync(result).isDirectory()) fail("installation root is not a directory");
  return result;
}
function assertManifestFile(path) {
  const stat = optionalStat(path);
  if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) fail("manifest is missing or linked");
  if (stat.size > MAX_MANIFEST_BYTES) fail("manifest byte limit exceeded");
  return stat;
}

/** Retains consistency evidence for an independently prepared installation, not a publisher signature. */
export function writeRuntimeManifest(root) {
  root = canonicalRoot(root);
  const path = join(root, MANIFEST),
    existing = optionalStat(path);
  if (existing && (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1))
    fail("manifest is linked or invalid");
  const manifest = scan(root),
    bytes = Buffer.from(JSON.stringify(manifest));
  if (bytes.length > MAX_MANIFEST_BYTES) fail("manifest byte limit exceeded");
  const temporary = join(root, `.canary-runtime.${randomUUID()}.tmp`);
  let fd;
  try {
    fd = openSync(temporary, "wx", 0o600);
    writeFileSync(fd, bytes);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, path);
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (optionalStat(temporary)) unlinkSync(temporary);
  }
  return summary(manifest);
}

/** Read-only verification of all retained paths, including dependencies and newly added runtime files. */
export function verifyRuntimeManifest(root, metadata) {
  root = canonicalRoot(root);
  if (
    !metadata ||
    !HASH.test(metadata.runtimeManifestHash) ||
    !Number.isSafeInteger(metadata.runtimeFileCount) ||
    metadata.runtimeFileCount < 1 ||
    metadata.runtimeFileCount > MAX_FILES ||
    !Number.isSafeInteger(metadata.runtimeBytes) ||
    metadata.runtimeBytes < 0 ||
    metadata.runtimeBytes > MAX_RUNTIME_BYTES ||
    !Number.isSafeInteger(metadata.runtimeMissingLinkCount) ||
    metadata.runtimeMissingLinkCount < 0 ||
    metadata.runtimeMissingLinkCount > metadata.runtimeFileCount
  )
    fail("bound manifest metadata is invalid");
  const path = join(root, MANIFEST),
    before = assertManifestFile(path),
    bytes = readFileSync(path);
  if (identity(assertManifestFile(path)) !== identity(before)) fail("manifest changed during verification");
  const manifest = parseManifest(bytes),
    retained = summary(manifest);
  if (Object.keys(retained).some((key) => retained[key] !== metadata[key]))
    fail("manifest does not match installation metadata");
  const actual = scan(root),
    observed = summary(actual);
  if (
    Object.keys(retained).some((key) => retained[key] !== observed[key]) ||
    JSON.stringify(actual) !== JSON.stringify(manifest)
  )
    fail("runtime files differ from the retained manifest");
  if (identity(assertManifestFile(path)) !== identity(before) || !readFileSync(path).equals(bytes))
    fail("manifest changed during verification");
  return retained;
}
