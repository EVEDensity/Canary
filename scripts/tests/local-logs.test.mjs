import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evidenceOutput, newLogDirectory } from "../lib/evidence-output.mjs";
import { runLogged } from "../run-logged.mjs";
import { logStatus, pruneLogs } from "../logs.mjs";

test("direct invocation resolves and launches the installed pnpm executable", () => {
  const env = { ...process.env };
  delete env.npm_execpath;
  const result = spawnSync(process.execPath, ["scripts/run-logged.mjs", "quick", "--", "pnpm", "--version"], {
    encoding: "utf8",
    env,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\d+\.\d+\.\d+/);
});

test("unique scoped log directories and explicit report destinations", (t) => {
  const root = mkdtempSync(join(tmpdir(), "canary-logs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.notEqual(newLogDirectory("tests", root), newLogDirectory("tests", root));
  assert.throws(() => newLogDirectory("../artifacts", root));
  const path = join(root, "export/result.json");
  assert.equal(evidenceOutput("r7", "unused.json", path), path);
  assert.ok(existsSync(join(root, "export")));
});
test("real failing process preserves its exit code and bounded redacted error evidence", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "canary-log-process-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = await runLogged(
    "tests",
    process.execPath,
    [
      "-e",
      "for(let i=0;i<3000;i++)console.log('progress '+i+' '+'.'.repeat(60)); console.error('Error: src/example.ts:12:3');console.error('Bearer local-test-private-value');process.exitCode=7",
    ],
    { root, quiet: true },
  );
  assert.equal(result.exitCode, 7);
  const output = readFileSync(join(result.directory, "stdout.log"), "utf8");
  const errors = readFileSync(join(result.directory, "stderr.log"), "utf8");
  assert.ok(output.length < 70_000);
  assert.match(errors, /src\/example\.ts:12:3/);
  assert.ok(!errors.includes("local-test-private-value"));
  const metadata = JSON.parse(readFileSync(join(result.directory, "result.json"), "utf8"));
  assert.equal(metadata.status, "failed");
  assert.equal(metadata.truncated, true);
  assert.ok(!existsSync(join(result.directory, "run.lock")));
});
test("missing executable leaves a completed failure record", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "canary-log-missing-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = await runLogged("tests", "canary-executable-does-not-exist", [], { root, quiet: true });
  assert.equal(result.exitCode, 1);
  assert.equal(JSON.parse(readFileSync(join(result.directory, "result.json"))).status, "interrupted");
});
test("cleanup is preview-only by default and protects active, incomplete, unknown and linked directories", (t) => {
  const root = mkdtempSync(join(tmpdir(), "canary-log-prune-")),
    logs = join(root, "logs"),
    artifacts = join(root, "artifacts");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(logs);
  mkdirSync(artifacts);
  writeFileSync(join(artifacts, "keep.txt"), "original evidence");
  function record(name, extra = {}) {
    const dir = join(logs, name);
    mkdirSync(dir);
    writeFileSync(
      join(dir, "result.json"),
      JSON.stringify({ kind: "canary.local-log", status: "passed", finishedAt: "2020-01-01T00:00:00Z", ...extra }),
    );
    return dir;
  }
  const old = record("old"),
    locked = record("locked"),
    partial = record("partial", { status: "running" });
  record("unknown", { kind: "foreign" });
  record("recent", { finishedAt: new Date().toISOString() });
  writeFileSync(join(locked, "run.lock"), "active");
  mkdirSync(join(logs, "legacy"));
  writeFileSync(join(logs, "legacy/raw.log"), "unmanaged history");
  symlinkSync(artifacts, join(logs, "linked"), process.platform === "win32" ? "junction" : "dir");
  assert.deepEqual(pruneLogs(logs).candidates, ["old"]);
  assert.ok(existsSync(old));
  assert.deepEqual(pruneLogs(logs, true).removed, ["old"]);
  assert.ok(existsSync(locked) && existsSync(partial));
  assert.equal(readFileSync(join(artifacts, "keep.txt"), "utf8"), "original evidence");
  assert.equal(logStatus(logs).protectedRuns, 2);
});
