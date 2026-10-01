import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { githubReport } from "../lib/github-report.mjs";

const commit = "a".repeat(40);
test("only version-bound, unchanged, tracked source can receive escaped annotations", () => {
  const root = mkdtempSync(join(tmpdir(), "canary-gh-map-"));
  try {
    writeFileSync(join(root, "code.mjs"), "export const value = 1;\n");
    const input = { ci: { exitCode: 1, runId: "run_test", summary: { total: 1, passed: 0, failed: 1 } }, diagnostics: { runId: "run_test", reproduction: { gitCommit: commit }, failures: [{ id: "test", category: "assertion\n::warning::injected", locations: [{ path: "code.mjs", line: 1, mapping: "path-line" }, { path: "../outside.mjs", line: 1, mapping: "path-line" }, { path: "code.mjs", line: 999, mapping: "path-line" }] }] }, verified: true, expectedSha: commit, actualSha: commit, projectRoot: root, workspace: root, sourceUnchanged: true, tracked: new Set(["code.mjs"]), repository: "owner/repo", workflowRunId: "123" };
    const report = githubReport(input);
    assert.equal(report.outcome, "failed");
    assert.equal(report.annotations.length, 1);
    assert.equal(report.annotations[0].split("\n").length, 1);
    assert.ok(report.summary.includes(`/blob/${commit}/code.mjs#L1`));
    for (const patch of [{ verified: false }, { sourceUnchanged: false }, { expectedSha: "b".repeat(40) }, { tracked: new Set() }]) assert.equal(githubReport({ ...input, ...patch }).annotations.length, 0);
    assert.equal(githubReport({ ...input, ci: { ...input.ci, exitCode: 0 }, verified: false }).outcome, "evidence-insufficient");
    assert.equal(githubReport({ ...input, ci: { ...input.ci, exitCode: 4 } }).outcome, "blocked");
    assert.equal(githubReport({ ...input, checkCounts: { failed: 0, blocked: 1 } }).outcome, "blocked");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("real CLI checks produce passed/failed summaries, sealed evidence and stale-head protection without tokens", () => {
  const root = mkdtempSync(join(tmpdir(), "canary-gh-real-"));
  const tool = resolve("scripts/github-verify.mjs");
  try {
    const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
    git("init", "-q");
    git("config", "user.name", "Canary test fixture");
    git("config", "user.email", "fixture@example.invalid");
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "canary-gh-fixture", private: true, scripts: { test: "node check.mjs" } }));
    writeFileSync(join(root, "check.mjs"), "import assert from 'node:assert/strict'; assert.equal(2+2,4);\n");
    git("add", "."); git("commit", "-qm", "Fixture baseline");
    let head = git("rev-parse", "HEAD");
    function run(name, expected = head) {
      const output = join(root, ".canary", name); mkdirSync(output, { recursive: true });
      const event = join(output, "event.json"); writeFileSync(event, JSON.stringify({ pull_request: { head: { sha: expected } } }));
      const summary = join(output, "job-summary.md");
      const result = spawnSync(process.execPath, [tool], { cwd: root, encoding: "utf8", timeout: 30000, env: { ...process.env, GITHUB_WORKSPACE: root, GITHUB_EVENT_PATH: event, GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: join(output, "outputs"), GITHUB_REPOSITORY: "fixture/repo", GITHUB_RUN_ID: "123", CANARY_REPORT_DIR: output, CANARY_PROJECT: ".", CANARY_CONFIG: "", GITHUB_TOKEN: "" } });
      assert.equal(result.status, 0, result.stderr);
      return { report: JSON.parse(readFileSync(join(output, "github-report.json"), "utf8")), stdout: result.stdout, output };
    }
    const passed = run("pass");
    assert.equal(passed.report.outcome, "passed"); assert.equal(passed.report.exitCode, 0); assert.equal(passed.report.evidenceVerified, true);
    assert.equal(run("repeat").report.outcome, "passed");
    writeFileSync(join(root, "check.mjs"), "import assert from 'node:assert/strict'; assert.equal(2+2,5);\n");
    git("add", "check.mjs"); git("commit", "-qm", "Failing assertion fixture"); head = git("rev-parse", "HEAD");
    const failed = run("fail");
    assert.equal(failed.report.outcome, "failed"); assert.equal(failed.report.exitCode, 1); assert.equal(failed.report.annotations.length, 1);
    assert.ok(failed.stdout.includes("::error file=check.mjs,line=1"));
    const stale = run("stale", "b".repeat(40)); assert.equal(stale.report.outcome, "stale"); assert.equal(stale.report.runId, null); assert.equal(stale.report.annotations.length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
