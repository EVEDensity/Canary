import { it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, realpathSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FileArtifactRepository } from "@canary/trace";
import { auditTestChanges } from "@canary/structure";
import { resolveProjectContext } from "../src/home.js";
import { bindPorts } from "../src/mcp.js";

it.each([false, true])("verifies a real repair with identical regression input and rejects weakening (CRLF %s)", (crlf) => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-r19-")));
  const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const call = (...args: string[]) => {
    const result = spawnSync(process.execPath, [cli, ...args, "--config", join(root, "canary.project.json")], {
      cwd: root,
      encoding: "utf8",
      timeout: 60000,
    });
    return { code: result.status, result: JSON.parse(result.stdout || "{}"), error: result.stderr };
  };
  try {
    git("init", "-q");
    git("config", "user.name", "Canary fixture");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "core.autocrlf", "false");
    if (crlf) writeFileSync(join(root, ".gitattributes"), "*.mjs text eol=crlf\nfixture.txt text eol=crlf\n");
    writeFileSync(join(root, ".gitignore"), ".canary/\n");
    writeFileSync(join(root, "package.json"), '{"name":"repair-fixture","type":"module"}');
    writeFileSync(join(root, "math.mjs"), "export const add = (a,b) => a+b-1;\n");
    writeFileSync(join(root, "fixture.txt"), "retained baseline input\n");
    writeFileSync(
      join(root, "basic.test.mjs"),
      "import assert from 'node:assert/strict'; import {add} from './math.mjs'; assert.equal(add(1,1),2);\n",
    );
    writeFileSync(join(root, "healthy.test.mjs"), "import assert from 'node:assert/strict'; assert.equal(4,4);\n");
    const checks = [
      { id: "original", type: "command", command: "node", args: ["basic.test.mjs"] },
      { id: "healthy", type: "command", command: "node", args: ["healthy.test.mjs"] },
    ];
    const config = (list: object[]) =>
      writeFileSync(
        join(root, "canary.project.json"),
        JSON.stringify({ kind: "canary.project", version: 1, checks: list }),
      );
    config(checks);
    git("add", ".");
    git("commit", "-qm", "Failing baseline");
    if (crlf) git("checkout", "--force", "HEAD", "--", ".");
    const baseline = call("run", "--ci").result;
    writeFileSync(join(root, "math.mjs"), "export const add = (a,b) => a+b;\n");
    writeFileSync(
      join(root, "regression.test.mjs"),
      "import assert from 'node:assert/strict'; import {add} from './math.mjs'; assert.equal(add(2,3),5);\n",
    );
    const candidateChecks = [
      ...checks,
      { id: "regression", type: "command", command: "node", args: ["regression.test.mjs"] },
    ];
    config(candidateChecks);
    git("add", ".");
    git("commit", "-qm", "Fix plus regression");
    if (crlf) git("checkout", "--force", "HEAD", "--", ".");
    const candidate = call("run", "--ci").result;
    expect(candidate.exitCode).toBe(0);
    const verified = call(
      "repair-verify",
      baseline.runId,
      candidate.runId,
      "--regression",
      "regression",
      "--test",
      "regression.test.mjs",
      "--execute",
    );
    expect(verified.result, verified.error).toMatchObject({ outcome: "verified", executed: true });
    const repository = new FileArtifactRepository(join(root, ".canary", "artifacts"));
    expect(repository.verify(verified.result.beforeRegression.runId).status).toBe("verified");
    const ports = bindPorts(resolveProjectContext({ cwd: root, configPath: join(root, "canary.project.json") }), { readRun: id => repository.readRun(id), runHeadless: async () => undefined });
    expect(ports.verification!({ runId: candidate.runId, kind: "repair" })).toMatchObject({ outcome: "verified", receipt: { executionSources: { original: { status: "unchanged" }, candidate: { status: "unchanged" } } } });
    expect(
      repository.readRun(verified.result.beforeRegression.runId)?.checks?.find((check) => check.id === "regression")
        ?.status,
    ).toBe("failed");
    expect(readFileSync(join(root, "math.mjs"), "utf8")).toContain("a+b;");
    const prepared = call("repair-verify", baseline.runId, candidate.runId, "--regression", "regression", "--test", "regression.test.mjs", "--prepare");
    expect(prepared.code, prepared.error).toBe(0);
    writeFileSync(join(prepared.result.beforeProject, "fixture.txt"), "altered baseline input\n");
    execFileSync("git", ["update-index", "--assume-unchanged", "fixture.txt"], { cwd: prepared.result.beforeProject });
    const changedStart = call("repair-verify", baseline.runId, candidate.runId, "--regression", "regression", "--test", "regression.test.mjs", "--workspace", prepared.result.beforeWorkspace, "--candidate-workspace", prepared.result.candidateWorkspace, "--execute");
    expect(changedStart.code).toBe(5);
    expect(changedStart.result.outcome).not.toBe("verified");
    rmSync(join(root, "basic.test.mjs"));
    config(candidateChecks.filter((check) => check.id !== "original"));
    git("add", ".");
    git("commit", "-qm", "Removed original verification");
    const weakened = call("run", "--ci").result;
    const rejected = call(
      "repair-verify",
      baseline.runId,
      weakened.runId,
      "--regression",
      "regression",
      "--test",
      "regression.test.mjs",
      "--execute",
    );
    expect(rejected.code).toBe(4);
    expect(rejected.result.executed).toBe(false);
    expect(rejected.result.findings, JSON.stringify(rejected.result)).toContainEqual({
      path: "basic.test.mjs",
      type: "test-file-deleted",
      certainty: "observed",
    });
    const skip = auditTestChanges([
      {
        path: "x.test.mjs",
        before: "import test from 'node:test'; test('x',()=>{});",
        after: "import test from 'node:test'; test.skip('x',()=>{});",
      },
    ]);
    expect(skip[0]?.type).toBe("skip-todo-or-only-added");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 90000);

it.each(["stage", "commit", "head"])("does not verify a repair after the baseline check changes Git %s", (mutation) => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-r22-repair-")));
  const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const call = (...args: string[]) => {
    const result = spawnSync(process.execPath, [cli, ...args, "--config", join(root, "canary.project.json")], { cwd: root, encoding: "utf8", timeout: 60000 });
    return { code: result.status, body: JSON.parse(result.stdout || "{}"), error: result.stderr };
  };
  try {
    git("init", "-q"); git("config", "user.name", "Canary fixture"); git("config", "user.email", "fixture@example.invalid"); git("config", "core.autocrlf", "false");
    writeFileSync(join(root, ".gitignore"), ".canary/\n");
    writeFileSync(join(root, "package.json"), '{"name":"repair-mutation-fixture","type":"module"}');
    writeFileSync(join(root, "math.mjs"), "export const add = (a,b) => a+b-1;\n");
    writeFileSync(join(root, "original.test.mjs"), "import assert from 'node:assert/strict'; import {add} from './math.mjs'; assert.equal(add(1,1),2);\n");
    const original = { id: "original", type: "command", command: "node", args: ["original.test.mjs"] };
    const config = (checks: unknown[]) => writeFileSync(join(root, "canary.project.json"), JSON.stringify({ kind: "canary.project", version: 1, checks }));
    config([original]); git("add", "."); git("commit", "-qm", "baseline");
    const baseline = call("run", "--ci").body;
    writeFileSync(join(root, "math.mjs"), "export const add = (a,b) => a+b;\n");
    const alter = mutation === "head"
      ? "execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-qm','changed head']);"
      : "appendFileSync('math.mjs','\\n// changed during verification\\n'); execFileSync('git',['add','math.mjs']);" + (mutation === "commit" ? "execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','changed source']);" : "");
    writeFileSync(join(root, "regression.test.mjs"), "import assert from 'node:assert/strict'; import {execFileSync} from 'node:child_process'; import {appendFileSync} from 'node:fs'; import {add} from './math.mjs'; const value=add(2,3); if(value!==5){" + alter + "} assert.equal(value,5);\n");
    config([original, { id: "regression", type: "command", command: "node", args: ["regression.test.mjs"] }]);
    git("add", "."); git("commit", "-qm", "candidate");
    const candidate = call("run", "--ci").body;
    expect(candidate.exitCode).toBe(0);
    const receipt = call("repair-verify", baseline.runId, candidate.runId, "--regression", "regression", "--test", "regression.test.mjs", "--execute");
    expect(receipt.body, receipt.error).toMatchObject({ outcome: "evidence-insufficient", executed: true, beforeRegression: { sourceUnchanged: false } });
    expect(receipt.code).toBe(4);
    expect(git("status", "--porcelain")).toBe("");
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 90000);
