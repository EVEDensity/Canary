import { expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { FileArtifactRepository, sha256, verifyRepairTaskBundle } from "@canary/trace";

function cleanup(root: string, temp: string) {
  const rel = relative(temp, root);
  if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("Unsafe fixture cleanup");
  rmSync(root, { recursive: true, force: true });
}

it("hands a real failure to scoped candidate review and existing before/after repair verification", () => {
  const temp = realpathSync.native(tmpdir()), root = realpathSync.native(mkdtempSync(join(temp, "canary-r25-")));
  const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const call = (...args: string[]) => {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: join(root, "src"), encoding: "utf8", timeout: 60_000 });
    expect(result.error, result.stderr).toBeUndefined();
    return { code: result.status, body: JSON.parse(result.stdout || "{}"), stdout: result.stdout, error: result.stderr };
  };
  const checks = [{ id: "original", type: "command", command: "node", args: ["tests/basic.test.mjs"] }, { id: "healthy", type: "command", command: "node", args: ["tests/healthy.test.mjs"] }];
  const config = (list: object[]) => writeFileSync(join(root, "canary.project.json"), JSON.stringify({ kind: "canary.project", version: 1, checks: list }));
  const commit = (message: string) => { git("add", "."); git("commit", "-qm", message); return git("rev-parse", "HEAD"); };
  const output = join(root, ".canary", "repair-tasks", "task.json");
  try {
    git("init", "-q"); git("config", "user.name", "Canary fixture"); git("config", "user.email", "fixture@example.invalid"); git("config", "core.autocrlf", "false");
    mkdirSync(join(root, "src")); mkdirSync(join(root, "tests"));
    writeFileSync(join(root, ".gitignore"), ".canary/\n");
    writeFileSync(join(root, "package.json"), '{"name":"repair-task-fixture","type":"module"}');
    writeFileSync(join(root, "src", "math.mjs"), "export const add=(a,b)=>a+b-1;\n");
    const originalTest = "import assert from 'node:assert/strict'; import {add} from '../src/math.mjs'; assert.equal(add(1,1),2);\n";
    writeFileSync(join(root, "tests", "basic.test.mjs"), originalTest);
    writeFileSync(join(root, "tests", "healthy.test.mjs"), "import assert from 'node:assert/strict'; assert.equal(4,4);\n");
    config(checks); commit("Recorded failure");
    const baseline = call("run", "--ci");
    expect(baseline.code, baseline.error).toBe(1);
    const baselineId = baseline.body.runId;
    const repository = new FileArtifactRepository(join(root, ".canary", "artifacts"));
    const manifest = repository.verify(baselineId).manifestHash;
    const sourceHash = sha256(readFileSync(join(root, "src", "math.mjs")));
    const created = call("repair-task", "create", baselineId, "--allow", "src", "--allow", "tests", "--allow", "canary.project.json", "--out", output);
    expect(created.code, created.error).toBe(0);
    expect(created.body.task.blockers, created.error).toEqual([]);
    expect(created.body.task).toMatchObject({ selectedChecks: ["original"], originalChecks: [{ id: "original" }, { id: "healthy" }], executionGranted: false });
    expect(created.body.task.failures[0].originalError.stderr).toContain("AssertionError");
    expect(JSON.stringify(created.body)).not.toContain(root.replaceAll("\\", "\\\\"));
    expect(verifyRepairTaskBundle(JSON.parse(readFileSync(output, "utf8")))).toBe(true);
    expect(created.stdout).toBe(readFileSync(output, "utf8"));
    expect(repository.verify(baselineId).manifestHash).toBe(manifest);
    expect(sha256(readFileSync(join(root, "src", "math.mjs")))).toBe(sourceHash);
    expect(git("status", "--porcelain")).toBe("");
    expect(call("repair-task", "verify", output).body).toMatchObject({ valid: true, trust: "integrity-only", executionGranted: false });
    expect(call("repair-task", "create", baselineId, "--check", "healthy").code).toBe(2);
    expect(call("repair-task", "create", baselineId, "--allow", "../outside").code).toBe(2);
    expect(call("repair-task", "create", baselineId, "--allow", "src", "--allow", "src").code).toBe(2);
    expect(call("repair-task", "create", baselineId, "--allow", "src", "--out", output).code).toBe(2);
    expect(call("repair-task", "create", baselineId, "--out", join(root, ".canary", "artifacts", baselineId, "injected.json")).code).toBe(2);
    const alias = join(root, "artifact-alias");
    symlinkSync(join(root, ".canary", "artifacts", baselineId), alias, process.platform === "win32" ? "junction" : "dir");
    expect(call("repair-task", "create", baselineId, "--out", join(alias, "injected.json")).code).toBe(2);
    expect(repository.verify(baselineId)).toMatchObject({ status: "verified", manifestHash: manifest });
    unlinkSync(alias);
    const half = join(root, ".canary", "repair-tasks", "half.json"); writeFileSync(half, '{"v":1,');
    expect(call("repair-task", "verify", half).code).toBe(2);
    writeFileSync(half, '{"password":plain-sensitive-fixture}');
    const malformed = call("repair-task", "verify", half);
    expect(malformed.code).toBe(2);
    expect(malformed.error).not.toContain("plain-sensitive-fixture");
    const unspecified = call("repair-task", "create", baselineId);
    const unspecifiedPath = join(root, ".canary", "repair-tasks", "unspecified.json"); writeFileSync(unspecifiedPath, JSON.stringify(unspecified.body));
    expect(unspecified.body.task.scope.status).toBe("unspecified");

    writeFileSync(join(root, "src", "math.mjs"), "export const add=(a,b)=>a+b;\n");
    writeFileSync(join(root, "tests", "regression.test.mjs"), "import assert from 'node:assert/strict'; import {add} from '../src/math.mjs'; assert.equal(add(2,3),5);\n");
    const candidateChecks = [...checks, { id: "regression", type: "command", command: "node", args: ["tests/regression.test.mjs"] }];
    config(candidateChecks); const goodCommit = commit("Repair with regression");
    const rerun = created.body.task.commands.find((command: { intent: string }) => command.intent === "rerun-after-authorization");
    expect(rerun.argv[0]).toBe("canary");
    const candidate = call(...rerun.argv.slice(1)); expect(candidate.code, candidate.error).toBe(0);
    const admitted = call("repair-task", "check", output, candidate.body.runId);
    expect(admitted.code, admitted.error).toBe(0);
    expect(admitted.body).toMatchObject({ outcome: "ready-for-regression", repairVerified: false, executed: false, reasons: [] });
    expect(call("repair-task", "check", unspecifiedPath, candidate.body.runId).code).toBe(4);
    const verified = call("repair-verify", baselineId, candidate.body.runId, "--regression", "regression", "--test", "tests/regression.test.mjs", "--execute");
    expect(verified.code, verified.error).toBe(0);
    expect(verified.body).toMatchObject({ outcome: "verified", executed: true, beforeRegression: { sourceUnchanged: true } });

    writeFileSync(join(root, "outside.md"), "Unrelated change\n"); commit("Out-of-scope candidate");
    const outside = call("run", "--ci"); expect(outside.code, outside.error).toBe(0);
    const denied = call("repair-task", "check", output, outside.body.runId);
    expect(denied.code, denied.error).toBe(4);
    expect(denied.body.reasons.join(" ")).toContain("outside the declared repair scope: outside.md");

    git("checkout", "-q", "-B", "leading-space", goodCommit);
    const leadingScope = join(root, ".canary", "repair-tasks", "leading-scope.json");
    expect(call("repair-task", "create", baselineId, "--allow", "src", "--allow", "tests", "--allow", "canary.project.json", "--allow", "outside.js", "--out", leadingScope).code).toBe(0);
    writeFileSync(join(root, " outside.js"), "// different from the permitted outside.js\n"); commit("Leading-space out-of-scope candidate");
    const leading = call("run", "--ci"); expect(leading.code, leading.error).toBe(0);
    const leadingDenied = call("repair-task", "check", leadingScope, leading.body.runId);
    expect(leadingDenied.code, leadingDenied.error).toBe(4);
    expect(leadingDenied.body.changedFiles).toContain(" outside.js");
    expect(leadingDenied.body.reasons.join(" ")).toContain("outside the declared repair scope:  outside.js");

    git("checkout", "-q", "-B", "weak", goodCommit);
    writeFileSync(join(root, "tests", "basic.test.mjs"), "import assert from 'node:assert/strict'; assert(true);\n"); commit("Weakened assertion");
    const weak = call("run", "--ci"); expect(weak.code, weak.error).toBe(0);
    const weakened = call("repair-task", "check", output, weak.body.runId);
    expect(weakened.code, weakened.error).toBe(4);
    expect(weakened.body.findings).toContainEqual(expect.objectContaining({ path: "tests/basic.test.mjs", type: "unconditional-assertion-added", certainty: "observed" }));

    git("checkout", "-q", "-B", "removed-check", goodCommit);
    config(candidateChecks.filter(check => check.id !== "healthy")); commit("Removed healthy original check");
    const removed = call("run", "--ci"); expect(removed.code, removed.error).toBe(0);
    const missing = call("repair-task", "check", output, removed.body.runId);
    expect(missing.code, missing.error).toBe(4);
    expect(missing.body.reasons.join(" ")).toContain("Original check healthy was removed or changed");

    repository.writeJson(baselineId, "review-note.json", { reviewed: true });
    expect(call("repair-task", "verify", output).code).toBe(0);
    const stale = call("repair-task", "check", output, candidate.body.runId);
    expect(stale.code).toBe(2);
    expect(stale.error).toContain("Source manifest changed");
  } finally { cleanup(root, temp); }
}, 120_000);
