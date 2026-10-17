import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeRuntimeManifest, verifyRuntimeManifest } from "../lib/runtime-manifest.mjs";

function fixture(t) {
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), "canary runtime manifest "))),
    root = join(base, "installation");
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 3 }));
  for (const dir of [
    "packages/cli/dist",
    "packages/core/dist",
    "apps/web/dist",
    "scripts/lib",
    "node_modules/.pnpm/example/node_modules/example",
  ])
    mkdirSync(join(root, dir), { recursive: true });
  for (const [path, contents] of Object.entries({
    "package.json": '{"private":true}',
    "pnpm-lock.yaml": "lockfileVersion: 9.0\n",
    "pnpm-workspace.yaml": "packages: [packages/*]\n",
    "tsconfig.base.json": "{}",
    "packages/cli/package.json": '{"version":"1.0.0"}',
    "packages/cli/dist/index.js": "export const version='1.0.0';\n",
    "packages/core/dist/index.js": "export const core=true;\n",
    "apps/web/dist/index.js": "export const web=true;\n",
    "scripts/lib/installer.mjs": "export const installer=true;\n",
    "node_modules/.pnpm/example/node_modules/example/index.js": "export const dependency=true;\n",
  }))
    writeFileSync(join(root, path), contents);
  return { base, root, manifest: join(root, ".canary-runtime.json") };
}
const integrityError = /Runtime integrity check failed/;

test("records complete package, web, script and dependency files and verifies without mutation", (t) => {
  const f = fixture(t),
    metadata = writeRuntimeManifest(f.root),
    bytes = readFileSync(f.manifest),
    before = lstatSync(f.manifest);
  assert.equal(metadata.runtimeFileCount, 10);
  assert.match(metadata.runtimeManifestHash, /^[a-f0-9]{64}$/);
  assert.ok(metadata.runtimeBytes > 0);
  assert.deepEqual(verifyRuntimeManifest(f.root, metadata), metadata);
  assert.deepEqual(readFileSync(f.manifest), bytes);
  assert.equal(lstatSync(f.manifest).mtimeMs, before.mtimeMs);
  assert.equal(writeRuntimeManifest(f.root).runtimeManifestHash, metadata.runtimeManifestHash);
  const relocated = join(f.base, "relocated");
  cpSync(f.root, relocated, { recursive: true });
  assert.deepEqual(verifyRuntimeManifest(relocated, metadata), metadata);
});

test("detects dependency mutation, missing files, added code and optional root config additions", (t) => {
  const f = fixture(t),
    metadata = writeRuntimeManifest(f.root),
    dep = join(f.root, "node_modules/.pnpm/example/node_modules/example/index.js"),
    original = readFileSync(dep);
  writeFileSync(dep, "export const dependency=false;\n");
  assert.throws(() => verifyRuntimeManifest(f.root, metadata), integrityError);
  writeFileSync(dep, original);
  rmSync(dep);
  assert.throws(() => verifyRuntimeManifest(f.root, metadata), integrityError);
  writeFileSync(dep, original);
  const added = join(f.root, "packages/core/dist/injected.js");
  writeFileSync(added, "export const injected=true");
  assert.throws(() => verifyRuntimeManifest(f.root, metadata), integrityError);
  rmSync(added);
  assert.deepEqual(verifyRuntimeManifest(f.root, metadata), metadata);
  rmSync(join(f.root, "tsconfig.base.json"));
  const withoutConfig = writeRuntimeManifest(f.root);
  writeFileSync(join(f.root, "tsconfig.base.json"), "{}");
  assert.throws(() => verifyRuntimeManifest(f.root, withoutConfig), integrityError);
});

test("tracks internal pnpm links without recursion and rejects changed, external and broken links", (t) => {
  const f = fixture(t),
    target = join(f.root, "node_modules/.pnpm/example/node_modules/example"),
    link = join(f.root, "node_modules/example");
  symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
  const metadata = writeRuntimeManifest(f.root),
    manifest = JSON.parse(readFileSync(f.manifest));
  assert.deepEqual(
    manifest.entries.find((entry) => entry.path === "node_modules/example"),
    {
      type: "link",
      path: "node_modules/example",
      target: "node_modules/.pnpm/example/node_modules/example",
    },
  );
  assert.deepEqual(verifyRuntimeManifest(f.root, metadata), metadata);
  // A directory cycle is a retained link and is not traversed recursively.
  const cycle = join(f.root, "node_modules/cycle");
  symlinkSync(join(f.root, "node_modules"), cycle, process.platform === "win32" ? "junction" : "dir");
  assert.deepEqual(verifyRuntimeManifest(f.root, writeRuntimeManifest(f.root)), writeRuntimeManifest(f.root));
  rmSync(cycle);
  rmSync(link);
  symlinkSync(join(f.root, "packages/core"), link, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => verifyRuntimeManifest(f.root, metadata), integrityError);
  rmSync(link);
  symlinkSync(f.base, link, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => writeRuntimeManifest(f.root), /link leaves/);
  rmSync(link);
  symlinkSync(join(f.root, "missing"), link, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => writeRuntimeManifest(f.root), /broken or cyclic/);
});

test("rejects malformed, oversized and unbound manifests without rewriting them", (t) => {
  const f = fixture(t),
    metadata = writeRuntimeManifest(f.root),
    original = readFileSync(f.manifest);
  for (const contents of [
    "{",
    "{}",
    JSON.stringify({ ...JSON.parse(original), extra: true }),
    " ".repeat(4 * 1024 * 1024 + 1),
  ]) {
    writeFileSync(f.manifest, contents);
    assert.throws(() => verifyRuntimeManifest(f.root, metadata), integrityError);
    assert.equal(readFileSync(f.manifest, "utf8"), contents);
  }
  writeFileSync(f.manifest, original);
  assert.throws(() => verifyRuntimeManifest(f.root, { ...metadata, runtimeManifestHash: "0".repeat(64) }), /metadata/);
  assert.throws(
    () => verifyRuntimeManifest(f.root, { ...metadata, runtimeFileCount: metadata.runtimeFileCount + 1 }),
    /metadata/,
  );
  assert.throws(() => verifyRuntimeManifest(f.root, {}), /metadata/);
  const manifest = JSON.parse(original);
  manifest.entries[0].path = "../outside.js";
  writeFileSync(f.manifest, JSON.stringify(manifest));
  assert.throws(() => verifyRuntimeManifest(f.root, metadata), /path/);
});

test("retains only declared optional dependency missing links and detects a newly available target", (t) => {
  const f = fixture(t),
    modules = join(f.root, "node_modules/.pnpm/builder@1.0.0_@types+node@22.0.0/node_modules"),
    packageDir = join(modules, "builder"),
    dependency = join(modules, "optional-platform"),
    target = join(f.root, "node_modules/.pnpm/optional-platform@1.0.0/node_modules/optional-platform");
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(
    join(packageDir, "package.json"),
    JSON.stringify({ name: "builder", optionalDependencies: { "optional-platform": "1.0.0" } }),
  );
  symlinkSync(target, dependency, process.platform === "win32" ? "junction" : "dir");
  const hoisted = join(f.root, "node_modules/.pnpm/node_modules/optional-platform");
  mkdirSync(join(f.root, "node_modules/.pnpm/node_modules"), { recursive: true });
  symlinkSync(target, hoisted, process.platform === "win32" ? "junction" : "dir");
  const metadata = writeRuntimeManifest(f.root);
  assert.equal(metadata.runtimeMissingLinkCount, 2);
  assert.deepEqual(verifyRuntimeManifest(f.root, metadata), metadata);
  const entry = JSON.parse(readFileSync(f.manifest)).entries.find((item) =>
    item.path.endsWith("/node_modules/optional-platform"),
  );
  assert.deepEqual(entry, {
    type: "link",
    path: "node_modules/.pnpm/builder@1.0.0_@types+node@22.0.0/node_modules/optional-platform",
    target: "node_modules/.pnpm/optional-platform@1.0.0/node_modules/optional-platform",
    state: "missing",
  });
  mkdirSync(target, { recursive: true });
  assert.throws(() => verifyRuntimeManifest(f.root, metadata), integrityError);
  rmSync(join(f.root, "node_modules/.pnpm/optional-platform@1.0.0"), { recursive: true });
  writeFileSync(
    join(packageDir, "package.json"),
    JSON.stringify({ name: "builder", dependencies: { "optional-platform": "1.0.0" } }),
  );
  assert.throws(() => writeRuntimeManifest(f.root), /broken or cyclic/);
});

test("strict schemas reject excessive entries, oversized retained totals, duplicate paths and non-string hashes", (t) => {
  const f = fixture(t),
    metadata = writeRuntimeManifest(f.root),
    original = JSON.parse(readFileSync(f.manifest));
  for (const entries of [
    Array(30001).fill({ type: "link", path: "packages/a", target: "." }),
    original.entries.map((entry, index) => (index === 0 ? { ...entry, size: 1024 * 1024 * 1024 + 1 } : entry)),
    [original.entries[0], ...original.entries],
    original.entries.map((entry, index) => (index === 0 ? { ...entry, sha256: [entry.sha256] } : entry)),
  ]) {
    writeFileSync(f.manifest, JSON.stringify({ ...original, entries }));
    assert.throws(() => verifyRuntimeManifest(f.root, metadata), integrityError);
  }
});

test("optional dependency declarations never allow an external target or an escaped existing parent", (t) => {
  const f = fixture(t),
    link = join(f.root, "node_modules/optional-platform"),
    packageFile = join(f.root, "package.json");
  writeFileSync(packageFile, JSON.stringify({ optionalDependencies: { "optional-platform": "1.0.0" } }));
  symlinkSync(join(f.base, "outside-missing"), link, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => writeRuntimeManifest(f.root), /link leaves/);
  rmSync(link);
  const parent = join(f.root, "node_modules/external-parent");
  symlinkSync(f.base, parent, process.platform === "win32" ? "junction" : "dir");
  symlinkSync(join(parent, "missing"), link, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => writeRuntimeManifest(f.root), /link leaves/);
});

test("rejects linked manifest paths and runtime byte limits before publishing a manifest", (t) => {
  const f = fixture(t),
    metadata = writeRuntimeManifest(f.root),
    saved = readFileSync(f.manifest),
    other = join(f.base, "manifest.json");
  writeFileSync(other, saved);
  rmSync(f.manifest);
  try {
    symlinkSync(other, f.manifest, "file");
  } catch (error) {
    if (process.platform === "win32" && error.code === "EPERM") {
      // Junctions are available on Windows without Developer Mode; they are also rejected for manifests.
      symlinkSync(f.base, f.manifest, "junction");
    } else throw error;
  }
  assert.throws(() => writeRuntimeManifest(f.root), /manifest is linked/);
  assert.throws(() => verifyRuntimeManifest(f.root, metadata), /manifest is missing or linked/);
  rmSync(f.manifest);
  const huge = join(f.root, "packages/core/huge.bin");
  writeFileSync(huge, "");
  truncateSync(huge, 1024 * 1024 * 1024 + 1);
  assert.throws(() => writeRuntimeManifest(f.root), /byte limit/);
});

test("minimal legacy-shaped runtime can be inventoried but a missing CLI cannot", (t) => {
  const f = fixture(t),
    root = join(f.base, "minimal");
  mkdirSync(join(root, "packages/cli/dist"), { recursive: true });
  writeFileSync(join(root, "packages/cli/package.json"), '{"version":"1.0.0"}');
  writeFileSync(join(root, "packages/cli/dist/index.js"), "console.log('fixture')");
  const metadata = writeRuntimeManifest(root);
  assert.equal(metadata.runtimeFileCount, 2);
  assert.deepEqual(verifyRuntimeManifest(root, metadata), metadata);
  rmSync(join(root, "packages/cli/dist/index.js"));
  assert.throws(() => verifyRuntimeManifest(root, metadata), /CLI runtime is missing/);
});

test("binds the official delivered Skill without including unrelated integrations", (t) => {
  const f = fixture(t),
    skill = join(f.root, "integrations/skills/canary-verify"),
    unrelated = join(f.root, "integrations/unrelated");
  mkdirSync(skill, { recursive: true });
  mkdirSync(unrelated, { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "---\nname: canary-verify\ndescription: Verify project evidence\n---\n");
  writeFileSync(join(unrelated, "example.json"), "{}");
  const metadata = writeRuntimeManifest(f.root);
  assert.equal(metadata.runtimeFileCount, 11);
  assert.deepEqual(verifyRuntimeManifest(f.root, metadata), metadata);
  writeFileSync(join(unrelated, "example.json"), '{"changed":true}');
  assert.deepEqual(verifyRuntimeManifest(f.root, metadata), metadata);
  writeFileSync(join(skill, "SKILL.md"), "Unexpected instruction change\n");
  assert.throws(() => verifyRuntimeManifest(f.root, metadata), integrityError);
});
