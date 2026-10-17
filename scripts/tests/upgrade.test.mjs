import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runCommand } from "../lib/command-runner.mjs";
import { publishInstallation } from "../lib/install-state.mjs";
import { resolveStableRelease } from "../lib/release-source.mjs";
import { upgradeInstallation, upgradeStatus } from "../lib/upgrade.mjs";

const installationLibrary = pathToFileURL(
  resolve(dirname(fileURLToPath(import.meta.url)), "../lib/install-state.mjs"),
).href;
const oldCommit = "a".repeat(40),
  nextCommit = "b".repeat(40);
const latest = {
  tag: "v1.1.0",
  version: "1.1.0",
  commit: nextCommit,
  url: "https://github.com/EVEDensity/Canary/releases/tag/v1.1.0",
  publishedAt: "2026-10-17T01:00:00Z",
};

function scratch(t) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "canary R28 upgrade ")));
  t.after(() => {
    const actual = realpathSync.native(root),
      rel = relative(realpathSync.native(tmpdir()), actual);
    assert.ok(!isAbsolute(rel) && rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\"));
    rmSync(actual, { recursive: true, force: true });
  });
  const metaDir = join(root, "registration"),
    binDir = join(root, "bin");
  const env = { ...process.env, CANARY_INSTALL_HOME: metaDir, CANARY_BIN_DIR: binDir };
  delete env.CANARY_REF;
  delete env.CANARY_CHANNEL;
  delete env.CANARY_SOURCE;
  return { root, metaDir, binDir, env };
}

function runtime(root, version = "1.0.0") {
  mkdirSync(join(root, "packages/cli/dist"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "canary-upgrade-fixture", private: true, version }));
  writeFileSync(join(root, "packages/cli/package.json"), JSON.stringify({ name: "@canary/cli", version }));
  writeFileSync(join(root, "packages/cli/dist/helper.cjs"), "module.exports = {};\n");
  writeFileSync(
    join(root, "packages/cli/dist/index.js"),
    `require('./helper.cjs'); console.log(JSON.stringify({ kind: 'canary.version', v: 1, canaryVersion: ${JSON.stringify(version)}, nodeVersion: process.versions.node }));\n`,
  );
  return root;
}

function register(layout, { name = "old", version = "1.0.0", commit = oldCommit, channel = "stable" } = {}) {
  const root = runtime(join(layout.root, name), version);
  return publishInstallation({
    root,
    binDir: layout.binDir,
    metaDir: layout.metaDir,
    metadata: { version, commit, ref: commit, channel, sourceInstall: true, migrationVersion: 4 },
  });
}

function snapshot(root) {
  const files = {};
  function visit(path, name = "") {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = join(path, entry.name),
        key = name + entry.name;
      if (entry.isDirectory()) {
        files[key + "/"] = null;
        visit(child, key + "/");
      } else files[key] = readFileSync(child).toString("base64");
    }
  }
  visit(root);
  return files;
}

function activeBytes(layout) {
  return Object.fromEntries(
    [
      join(layout.metaDir, "home.json"),
      join(layout.binDir, "canary-run.mjs"),
      join(layout.binDir, process.platform === "win32" ? "canary.cmd" : "canary"),
    ].map((path) => [path, readFileSync(path).toString("base64")]),
  );
}

function capture(layout, overrides = {}) {
  const writes = [],
    calls = [];
  return {
    writes,
    calls,
    input: {
      env: layout.env,
      resolveRelease: async () => latest,
      write: (value) => writes.push(value),
      run: (command, args, options) => {
        calls.push({ command, args, options });
        return { status: 0 };
      },
      ...overrides,
    },
  };
}

test("read-only update checks neither execute a runtime nor change installation files", async (t) => {
  const layout = scratch(t);
  register(layout);
  const before = snapshot(layout.root),
    probe = capture(layout);
  await upgradeInstallation({ ...probe.input, args: ["--check", "--json"] });
  const result = JSON.parse(probe.writes[0]);
  assert.equal(result.kind, "canary.upgrade-check");
  assert.equal(result.v, 1);
  assert.equal(result.status, "update-available");
  assert.equal(result.updateAvailable, true);
  assert.equal(result.mutation, false);
  assert.deepEqual(result.latest, latest);
  assert.deepEqual(probe.calls, []);
  assert.deepEqual(snapshot(layout.root), before);
});

test("not-installed checks do not create metadata or an installation directory", async (t) => {
  const layout = scratch(t),
    probe = capture(layout),
    before = snapshot(layout.root);
  await upgradeInstallation({ ...probe.input, args: ["--check", "--json"] });
  assert.equal(JSON.parse(probe.writes[0]).status, "not-installed");
  assert.equal(JSON.parse(probe.writes[0]).current, null);
  assert.deepEqual(probe.calls, []);
  assert.deepEqual(snapshot(layout.root), before);
  assert.equal(existsSync(layout.metaDir), false);
  await assert.rejects(upgradeInstallation(probe.input), /No registered installation/);
  assert.equal(existsSync(layout.metaDir), false);
});

test("pinned installs retain their channel unless explicitly overridden", async (t) => {
  const layout = scratch(t);
  register(layout, { channel: "pinned" });
  const before = snapshot(layout.root),
    probe = capture(layout);
  await upgradeInstallation({ ...probe.input, args: ["--check", "--json"] });
  assert.equal(JSON.parse(probe.writes[0]).status, "pinned");
  assert.equal(JSON.parse(probe.writes[0]).updateAvailable, false);
  await assert.rejects(upgradeInstallation(probe.input), /Installation is pinned/);
  assert.deepEqual(probe.calls, []);
  assert.deepEqual(snapshot(layout.root), before);
});

test("explicit stable, main and ref choices hand the selected channel to the installer", async (t) => {
  const layout = scratch(t);
  register(layout, { channel: "pinned" });
  for (const explicit of [{ CANARY_CHANNEL: "stable" }, { CANARY_CHANNEL: "main" }, { CANARY_REF: oldCommit }]) {
    const probe = capture(layout, { env: { ...layout.env, ...explicit } });
    const before = activeBytes(layout);
    await upgradeInstallation(probe.input);
    assert.equal(probe.calls.length, 2);
    const [clone, install] = probe.calls;
    assert.equal(clone.command, "git");
    assert.deepEqual(clone.args.slice(0, 5), [
      "clone",
      "--branch",
      "main",
      "--",
      "https://github.com/EVEDensity/Canary.git",
    ]);
    assert.equal(dirname(clone.args[5]), join(layout.metaDir, "sources"));
    assert.equal(install.command, process.execPath);
    assert.equal(install.args[0], "--use-system-ca");
    assert.equal(install.args[1], join(clone.args[5], "scripts/install-global.mjs"));
    assert.equal(install.options.env.CANARY_CHANNEL, explicit.CANARY_CHANNEL ?? "stable");
    assert.equal(install.options.env.CANARY_REF, explicit.CANARY_REF);
    assert.equal(install.options.env.CANARY_BIN_DIR, layout.binDir);
    assert.deepEqual(activeBytes(layout), before, "an injected no-op installer cannot publish state");
  }
});

test("a verified same-version same-commit stable upgrade is a no-op", async (t) => {
  const layout = scratch(t);
  register(layout, { version: latest.version, commit: latest.commit });
  const before = snapshot(layout.root),
    probe = capture(layout);
  await upgradeInstallation(probe.input);
  assert.equal(JSON.parse(probe.writes[0]).status, "unchanged");
  assert.deepEqual(probe.calls, []);
  assert.deepEqual(snapshot(layout.root), before);
});

test("same-version different-commit and newer installations reject stable replacement", async (t) => {
  const layout = scratch(t);
  for (const version of [latest.version, "2.0.0"]) {
    register(layout, { name: "current-" + version, version });
    const before = snapshot(layout.root),
      probe = capture(layout);
    await assert.rejects(upgradeInstallation(probe.input), /downgrade or replace the same version/);
    assert.deepEqual(probe.calls, []);
    assert.deepEqual(snapshot(layout.root), before);
    await upgradeInstallation({ ...probe.input, args: ["--check", "--json"] });
    assert.equal(JSON.parse(probe.writes[0]).status, version === latest.version ? "version-conflict" : "ahead");
  }
});

test("publication rechecks the actual stable release against the locked active registration", (t) => {
  const layout = scratch(t);
  register(layout, { version: latest.version, commit: oldCommit });
  const before = activeBytes(layout);
  // Simulate a different release selected by the child installer after upgrade preflight.
  for (const version of ["1.0.0", latest.version]) {
    const root = runtime(join(layout.root, "prepared-" + version), version);
    assert.throws(
      () =>
        publishInstallation({
          root,
          binDir: layout.binDir,
          metaDir: layout.metaDir,
          metadata: { version, commit: nextCommit, ref: nextCommit, channel: "stable", releaseTag: "v" + version },
        }),
      /downgrade|same version|version.conflict|another commit/i,
    );
    assert.deepEqual(activeBytes(layout), before, "release drift cannot replace the active registration or launcher");
    assert.equal(existsSync(join(layout.metaDir, "install.lock")), false, "rejected publication releases its lock");
  }
});

test("oversized prior or next registration is rejected before active launcher publication", (t) => {
  const layout = scratch(t);
  register(layout);
  const home = join(layout.metaDir, "home.json"),
    original = readFileSync(home);
  const previous = JSON.parse(original),
    root = runtime(join(layout.root, "prepared"), latest.version);
  const metadata = { version: latest.version, commit: nextCommit, ref: nextCommit, channel: "main" };
  const limit = 1024 * 1024;
  for (const mode of ["prior-too-large", "next-too-large", "retained-prior-exceeds-next-limit"]) {
    writeFileSync(home, original);
    const incoming = { ...metadata };
    if (mode === "prior-too-large") writeFileSync(home, JSON.stringify({ ...previous, padding: "x".repeat(limit) }));
    if (mode === "next-too-large") incoming.padding = "x".repeat(limit);
    if (mode === "retained-prior-exceeds-next-limit") {
      const emptySize = Buffer.byteLength(JSON.stringify({ ...previous, padding: "" }));
      writeFileSync(home, JSON.stringify({ ...previous, padding: "x".repeat(limit - 64 - emptySize) }));
      assert.ok(readFileSync(home).length < limit, "the retained registration itself remains within the read limit");
    }
    const before = activeBytes(layout);
    assert.throws(
      () => publishInstallation({ root, binDir: layout.binDir, metaDir: layout.metaDir, metadata: incoming }),
      /registration.*size limit/i,
    );
    assert.deepEqual(activeBytes(layout), before, mode);
    assert.equal(existsSync(join(layout.metaDir, "install.lock")), false);
  }
});

test("release, clone and build failures preserve the active launcher and registration byte for byte", async (t) => {
  const layout = scratch(t);
  register(layout);
  const before = activeBytes(layout);
  const network = capture(layout, {
    resolveRelease: () =>
      resolveStableRelease({
        fetchImpl: async () => new Response("PRIVATE_TOKEN=do-not-print", { status: 403 }),
      }),
  });
  await assert.rejects(
    upgradeInstallation(network.input),
    (error) => /HTTP 403/.test(error.message) && !/PRIVATE_TOKEN/.test(error.stack),
  );
  assert.deepEqual(network.calls, []);
  assert.deepEqual(activeBytes(layout), before);
  for (const failedStep of [0, 1]) {
    let step = 0;
    const probe = capture(layout, { run: () => ({ status: step++ === failedStep ? 1 : 0 }) });
    await assert.rejects(
      upgradeInstallation(probe.input),
      failedStep === 0 ? /Upgrade source is unavailable/ : /Upgrade validation failed/,
    );
    assert.equal(step, failedStep + 1);
    assert.deepEqual(activeBytes(layout), before);
  }
});

test("rollback verifies the complete previous runtime before executing any of its code", async (t) => {
  const layout = scratch(t),
    previous = register(layout);
  register(layout, { name: "new", version: latest.version, commit: latest.commit });
  const marker = join(layout.root, "tampered-code-executed");
  writeFileSync(
    join(previous.root, "packages/cli/dist/helper.cjs"),
    `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'unsafe'); module.exports = {};\n`,
  );
  const before = activeBytes(layout),
    probe = capture(layout, { resolveRelease: () => assert.fail("rollback must not request a release") });
  await assert.rejects(upgradeInstallation({ ...probe.input, args: ["--rollback"] }), /Runtime integrity check failed/);
  assert.equal(existsSync(marker), false);
  assert.deepEqual(probe.calls, []);
  assert.deepEqual(activeBytes(layout), before);
});

test("legacy rollback verifies the retained CLI hash before executing the CLI", async (t) => {
  const layout = scratch(t),
    previous = register(layout);
  register(layout, { name: "new", version: latest.version, commit: latest.commit });
  const state = join(layout.metaDir, "home.json"),
    metadata = JSON.parse(readFileSync(state, "utf8"));
  delete metadata.previous.runtimeManifestHash;
  delete metadata.previous.runtimeFileCount;
  delete metadata.previous.runtimeBytes;
  writeFileSync(state, JSON.stringify(metadata));
  const marker = join(layout.root, "tampered-legacy-code-executed");
  writeFileSync(
    join(previous.root, "packages/cli/dist/index.js"),
    `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'unsafe');\n`,
  );
  const before = activeBytes(layout),
    probe = capture(layout);
  await assert.rejects(upgradeInstallation({ ...probe.input, args: ["--rollback"] }), /Registered runtime changed/);
  assert.equal(existsSync(marker), false);
  assert.deepEqual(activeBytes(layout), before);
});

test("conflicting, duplicate and unsupported flags are rejected before reads or network calls", async (t) => {
  const layout = scratch(t);
  for (const args of [
    ["--rollback", "--check"],
    ["--rollback", "--json"],
    ["--check", "--check"],
    ["--json", "--json", "--check"],
    ["--rollback", "--rollback"],
    ["--json"],
    ["--force"],
    ["stable"],
  ]) {
    const probe = capture(layout, { resolveRelease: () => assert.fail("invalid flags must not request releases") });
    await assert.rejects(upgradeInstallation({ ...probe.input, args }), /Use canary upgrade/);
    assert.deepEqual(probe.calls, []);
    assert.equal(existsSync(layout.metaDir), false);
  }
});

test("upgrade status distinguishes stable, pinned, development and absent installations", () => {
  assert.equal(upgradeStatus(undefined, latest, "stable"), "not-installed");
  assert.equal(upgradeStatus({ version: "1.0.0" }, latest, "stable"), "update-available");
  assert.equal(upgradeStatus({ version: latest.version, ref: latest.commit }, latest, "stable"), "up-to-date");
  assert.equal(upgradeStatus({ version: latest.version, commit: oldCommit }, latest, "stable"), "version-conflict");
  assert.equal(upgradeStatus({ version: "2.0.0" }, latest, "stable"), "ahead");
  assert.equal(upgradeStatus({ version: "working" }, latest, "main"), "development");
  assert.equal(upgradeStatus({ version: "working" }, latest, "pinned"), "pinned");
});

test("a real local Git source upgrades through a fixture installer and rolls back to the retained installation", async (t) => {
  const layout = scratch(t),
    initial = register(layout);
  const source = runtime(join(layout.root, "source repository"), latest.version);
  mkdirSync(join(source, "scripts"), { recursive: true });
  writeFileSync(
    join(source, "scripts/install-global.mjs"),
    `
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { publishInstallation } from ${JSON.stringify(installationLibrary)};
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
publishInstallation({ root, binDir: process.env.CANARY_BIN_DIR, metaDir: process.env.CANARY_INSTALL_HOME,
  metadata: { version: ${JSON.stringify(latest.version)}, commit, ref: commit, channel: process.env.CANARY_CHANNEL } });
`,
  );
  function git(args) {
    const result = runCommand("git", args, { cwd: source, encoding: "utf8", timeout: 30000 });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  git(["init", "-q", "-b", "main"]);
  git(["add", "."]);
  git([
    "-c",
    "user.name=Canary fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "Upgrade fixture",
  ]);
  const commit = git(["rev-parse", "HEAD"]),
    calls = [];
  const probe = capture(layout, {
    env: { ...layout.env, CANARY_SOURCE: source, CANARY_CHANNEL: "main" },
    resolveRelease: () => assert.fail("explicit non-official main source must not query stable releases"),
    run: (command, args, options) => {
      calls.push({ command, args });
      return runCommand(command, args, { ...options, stdio: "pipe", encoding: "utf8" });
    },
  });
  await upgradeInstallation(probe.input);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, "git");
  const installed = JSON.parse(readFileSync(join(layout.metaDir, "home.json"), "utf8"));
  assert.equal(installed.version, latest.version);
  assert.equal(installed.commit, commit);
  assert.equal(installed.channel, "main");
  assert.equal(installed.previous.root, initial.root);
  assert.notEqual(installed.root, initial.root);
  assert.ok(existsSync(join(installed.root, ".canary-runtime.json")));
  const launch = () =>
    runCommand(process.execPath, [join(layout.binDir, "canary-run.mjs"), "version", "--json"], {
      encoding: "utf8",
      timeout: 30000,
    });
  const upgraded = launch();
  assert.equal(upgraded.status, 0, upgraded.stderr);
  assert.equal(JSON.parse(upgraded.stdout).canaryVersion, latest.version);
  await upgradeInstallation({ ...probe.input, args: ["--rollback"] });
  const rolledBack = JSON.parse(readFileSync(join(layout.metaDir, "home.json"), "utf8"));
  assert.equal(rolledBack.root, initial.root);
  assert.equal(rolledBack.commit, oldCommit);
  assert.equal(rolledBack.previous.root, installed.root);
  assert.equal(JSON.parse(probe.writes.at(-1)).status, "rolled-back");
  const restored = launch();
  assert.equal(restored.status, 0, restored.stderr);
  assert.equal(JSON.parse(restored.stdout).canaryVersion, "1.0.0");
});
