import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { tmpdir, release } from "node:os";
import { dirname, join, resolve } from "node:path";
import { verifyArtifacts } from "../packages/trace/dist/index.js";
import { ciResultSchema } from "../packages/core/dist/index.js";

const root = realpathSync(resolve(import.meta.dirname, ".."));
const fixtures = join(root, "integrations/fixtures");
const base = realpathSync(mkdtempSync(join(tmpdir(), "Canary R6 projects ")));
const output = resolve(
  process.env.CANARY_R6_OUTPUT ??
    join(root, `docs/evidence/logs/r6-${process.platform}-node${process.versions.node.split(".")[0]}.json`),
);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const report = {
  version: 1,
  kind: "canary.r6.acceptance",
  date: new Date().toISOString(),
  platform: process.platform,
  osRelease: release(),
  node: process.version,
  executionContext: process.env.CANARY_R6_CONTEXT ?? "native",
  commit:
    spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true }).stdout?.trim() ??
    "unavailable",
  checks: [],
  artifactBase: base,
};
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    ["PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE"].includes(
      key.toUpperCase(),
    ),
  ),
);
function run(args, cwd, extra = {}) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [join(root, "packages/cli/dist/index.js"), ...args], {
      cwd,
      env: { ...env, ...extra },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    const timer = setTimeout(() => child.kill(), 60000);
    child.stdout.on("data", (c) => {
      stdout += c;
      if (stdout.length > 2_000_000) child.kill();
    });
    child.stderr.on("data", (c) => {
      stderr += c;
      if (stderr.length > 2_000_000) child.kill();
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      fail(error);
    });
    child.stdout.on("error", (error) => {
      clearTimeout(timer);
      fail(error);
    });
    child.stderr.on("error", (error) => {
      clearTimeout(timer);
      fail(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      done({ code, stdout, stderr });
    });
  });
}
async function check(name, action) {
  try {
    const evidence = await action();
    report.checks.push({ name, status: "verified", ...evidence });
  } catch (error) {
    report.checks.push({ name, status: "failed", reason: String(error.message).slice(0, 3000) });
    process.exitCode = 1;
  }
}
function project(name) {
  const dir = join(base, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}
function config(dir) {
  const path = join(dir, "checks.json");
  writeFileSync(
    path,
    JSON.stringify({
      kind: "canary.project",
      version: 1,
      checks: [{ id: "node", type: "command", command: process.execPath, args: ["-e", "console.log('R6')"] }],
    }),
  );
  return path;
}
async function ci(dir, path, expected = 0, extra = {}) {
  const result = await run(["run", "--ci", "--config", path], dir, extra);
  assert.equal(result.code, expected, result.stderr + result.stdout);
  assert.equal(result.stdout.trim().split(/\r?\n/).length, 1);
  const data = ciResultSchema.parse(JSON.parse(result.stdout));
  assert.equal(data.exitCode, expected);
  if (data.artifactPath && existsSync(data.artifactPath)) artifacts.add(dirname(data.artifactPath));
  if (expected === 0) assert.equal(verifyArtifacts(dirname(data.artifactPath)).status, "verified");
  return data;
}
function inventory(dir) {
  return Object.fromEntries(
    readdirSync(dir, { withFileTypes: true })
      .filter((entry) => !["node_modules", "dist", ".canary", ".git"].includes(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name, "en"))
      .flatMap((entry) =>
        entry.isDirectory()
          ? Object.entries(inventory(join(dir, entry.name))).map(([path, hash]) => [entry.name + "/" + path, hash])
          : [[entry.name, sha(readFileSync(join(dir, entry.name)))]],
      ),
  );
}
const before = inventory(fixtures);
const sourceFiles = Object.fromEntries(
  ["packages/cli/src/check-executor.ts", "scripts/verify-r6.mjs"].map((file) => [
    file,
    sha(readFileSync(join(root, file))),
  ]),
);
report.sourceFiles = sourceFiles;
report.sourceTreeHash = sha(
  JSON.stringify(
    Object.fromEntries(
      ["packages", "apps", "scripts", "integrations/fixtures"].map((folder) => [folder, inventory(join(root, folder))]),
    ),
  ),
);
const artifacts = new Set();
for (const id of ["deterministic-agent", "tool-calling-agent", "mcp-agent", "http-agent"]) {
  await check(id, async () => {
    const source = join(fixtures, id),
      meta = JSON.parse(readFileSync(join(source, "fixture.json"), "utf8"));
    for (const [file, hash] of Object.entries(meta.files))
      assert.equal(sha(readFileSync(join(source, file))), hash, `fixture changed: ${id}/${file}`);
    const dir = project(id + " with spaces");
    cpSync(source, dir, { recursive: true });
    let server;
    let extra = {};
    try {
      if (id === "http-agent") {
        server = spawn(process.execPath, [join(dir, "server.mjs")], { cwd: dir, env, windowsHide: true });
        const url = await new Promise((done, fail) => {
          let text = "";
          const timer = setTimeout(() => fail(Error("HTTP startup timeout")), 5000);
          server.once("error", fail);
          server.stdout.on("data", (chunk) => {
            text += chunk;
            if (text.includes("\n")) {
              clearTimeout(timer);
              try {
                done(JSON.parse(text.trim()).url);
              } catch (error) {
                fail(error);
              }
            }
          });
          server.once("exit", () => {
            clearTimeout(timer);
            fail(Error("HTTP exited before ready"));
          });
        });
        extra = { CANARY_R6_HTTP_URL: url };
      }
      const result = await ci(dir, join(dir, "canary.config.ts"), 0, extra);
      const snapshot = JSON.parse(readFileSync(result.artifactPath, "utf8"));
      assert.deepEqual(snapshot.results[0].output, meta.expectedOutput);
      if (id === "http-agent") assert.equal(snapshot.coverage.status, "unavailable");
      return {
        runId: result.runId,
        manifest: verifyArtifacts(dirname(result.artifactPath)).manifestHash,
        fixtureHash: sha(JSON.stringify(meta.files)),
      };
    } finally {
      if (server && server.exitCode === null) {
        const ended = new Promise((done) => server.once("exit", done));
        server.kill();
        await ended;
      }
    }
  });
}
await check("non-default-root-spaces", async () => {
  const dir = project("nested project spaces");
  const result = await ci(base, config(dir));
  assert.equal(realpathSync.native(dirname(dirname(dirname(dirname(result.artifactPath))))), realpathSync.native(dir));
  return { runId: result.runId };
});
await check("long-path", async () => {
  const dir = project(Array.from({ length: 7 }, (_, i) => "segment-" + i + "-" + "x".repeat(30)).join("/"));
  const result = await ci(base, config(dir));
  return { pathLength: dir.length, runId: result.runId };
});
await check("same-project-concurrent-runs", async () => {
  const dir = project("concurrent"),
    path = config(dir);
  const [a, b] = await Promise.all([ci(dir, path), ci(dir, path)]);
  assert.notEqual(a.runId, b.runId);
  assert.notEqual(a.artifactPath, b.artifactPath);
  return { runIds: [a.runId, b.runId] };
});
await check("artifact-root-unwritable-file", async () => {
  const dir = project("unwritable artifact"),
    path = config(dir);
  writeFileSync(join(dir, ".canary"), "not a directory");
  const result = await ci(dir, path, 5);
  return { exitCode: result.exitCode };
});
if (process.platform !== "win32" && process.getuid?.() !== 0)
  await check("filesystem-permission-denied", async () => {
    const dir = project("permission denied"),
      path = config(dir);
    chmodSync(dir, 0o500);
    try {
      return { exitCode: (await ci(dir, path, 5)).exitCode };
    } finally {
      chmodSync(dir, 0o700);
    }
  });
else if (process.platform === "win32")
  await check("filesystem-permission-denied", async () => {
    const dir = project("ACL denied"),
      path = config(dir),
      target = join(dir, ".canary");
    mkdirSync(target);
    const identity = spawnSync("whoami", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true });
    const sid = identity.stdout?.match(/S-1-[0-9-]+/)?.[0];
    assert.ok(sid, "Current user SID unavailable");
    const denied = spawnSync("icacls", [target, "/deny", `*${sid}:(OI)(CI)(W)`], {
      encoding: "utf8",
      windowsHide: true,
    });
    try {
      assert.equal(denied.status, 0, "Cannot set fixture-only deny ACL");
      return { exitCode: (await ci(dir, path, 5)).exitCode };
    } finally {
      const restored = spawnSync("icacls", [target, "/remove:d", `*${sid}`], { encoding: "utf8", windowsHide: true });
      assert.equal(restored.status, 0, "Fixture deny ACL restoration failed: " + target);
    }
  });
else
  report.checks.push({
    name: "filesystem-permission-denied",
    status: "blocked",
    reason: "Root bypasses POSIX permission denial; use a non-root runner.",
  });
report.checks.push({
  name: "pi-agent",
  status: "blocked",
  reason: JSON.parse(readFileSync(join(fixtures, "pi-agent/fixture.json"), "utf8")).reason,
});
await check("fixture-sources-unchanged", async () => {
  assert.deepEqual(inventory(fixtures), before);
  return { hash: sha(JSON.stringify(before)) };
});
if (process.env.CANARY_R6_EXPORT === "1")
  for (const path of artifacts)
    cpSync(path, join(dirname(output), "artifacts", path.split(/[\\/]/).pop()), { recursive: true });
report.localGate = report.checks.some((c) => c.status === "failed")
  ? "failed"
  : report.checks.some((c) => c.name !== "pi-agent" && c.status === "blocked")
    ? "blocked"
    : "passed";
report.stageComplete = false;
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
// Artifacts are retained for audit under artifactBase; no unrelated files are removed.
