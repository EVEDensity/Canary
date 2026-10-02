import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FileArtifactRepository, sha256 } from "@canary/trace";

const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
function fixture(requirements?: object, dependencies?: object, absoluteScript = false) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-r18-")));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, windowsHide: true, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.name", "Canary fixture");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "core.autocrlf", "false");
  writeFileSync(join(root, ".gitignore"), ".canary/\nnode_modules/\n");
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "canary-reproduction-fixture", private: true, dependencies }),
  );
  writeFileSync(
    join(root, "failure.mjs"),
    `import assert from 'node:assert/strict';\nimport { writeFileSync } from 'node:fs';\nwriteFileSync('home.txt', process.env.HOME || process.env.USERPROFILE || 'none');\nconsole.log(process.env.CANARY_FIXTURE_TOKEN || 'no credential');\nassert.equal(2 + 2, 5);\n`,
  );
  const config = join(root, "canary.project.json");
  writeFileSync(
    config,
    JSON.stringify({
      kind: "canary.project",
      version: 1,
      reproduction: requirements,
      checks: [
        {
          id: "assertion",
          type: "command",
          command: "node",
          args: [absoluteScript ? join(root, "failure.mjs") : "failure.mjs"],
          timeoutMs: 5000,
          envAllowlist: ["CANARY_FIXTURE_TOKEN"],
        },
      ],
    }),
  );
  git("add", ".");
  git("commit", "-qm", "Recorded failing source");
  const invoke = (...args: string[]) => {
    const execution = spawnSync(process.execPath, [cli, ...args], {
      cwd: root,
      windowsHide: true,
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 8 * 1024 * 1024,
      env: {
        ...process.env,
        CANARY_FIXTURE_TOKEN: "fixture-private-value-never-persist",
        CANARY_UNDECLARED_TOKEN: "unrelated-secret",
        CANARY_HOME: resolve(dirname(cli), "../../.."),
      },
    });
    return {
      code: execution.status,
      stdout: execution.stdout,
      stderr: execution.stderr,
      result: execution.stdout.trim() ? JSON.parse(execution.stdout) : undefined,
    };
  };
  const original = () =>
    invoke("run", "--ci", "--config", config).result as { runId: string; exitCode: number; artifactPath: string };
  const reproduce = (run: string, ...args: string[]) =>
    invoke("reproduce", run, "--check", "assertion", "--config", config, ...args);
  return {
    root,
    git,
    config,
    invoke,
    original,
    reproduce,
    repository: new FileArtifactRepository(join(root, ".canary", "artifacts")),
  };
}

describe("R18 version-bound reproduction", () => {
  it("reproduces an automatically discovered npm check without importing a configuration module", () => {
    const f = fixture();
    try {
      rmSync(f.config);
      writeFileSync(
        join(f.root, "package.json"),
        JSON.stringify({ name: "canary-reproduction-fixture", private: true, scripts: { test: "node failure.mjs" } }),
      );
      f.git("add", ".");
      f.git("commit", "-qm", "Automatic check fixture");
      const original = f.invoke("run", "--ci", "--project", f.root).result;
      expect(original.exitCode).toBe(1);
      const result = f.invoke("reproduce", original.runId, "--check", "node.test", "--project", f.root, "--execute");
      expect(result.result, result.stderr).toMatchObject({ outcome: "reproduced", executed: true, exitCode: 1 });
      expect(f.repository.verify(result.result.runId).status).toBe("verified");
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  }, 90000);
  it("restores a real failure independently, retains dirty caller files, forwards only authorized environment and seals lineage", () => {
    const f = fixture(undefined, undefined, true);
    try {
      const original = f.original();
      expect(original.exitCode).toBe(1);
      const parentHash = f.repository.verify(original.runId).manifestHash;
      const preview = f.reproduce(original.runId);
      expect(preview.result.outcome).toBe("ready");
      expect(preview.result.executed).toBe(false);
      expect(existsSync(join(f.root, ".canary", "reproductions"))).toBe(false);
      const prepared = f.reproduce(original.runId, "--prepare");
      expect(prepared.code).toBe(0);
      expect(prepared.result.outcome).toBe("prepared");
      expect(prepared.result.conditions).toEqual([]);
      const isolated = prepared.result.projectRoot as string;
      const lock = join(dirname(isolated), "execution.lock");
      writeFileSync(lock, "another execution");
      expect(f.reproduce(original.runId, "--execute", "--workspace", prepared.result.workspaceId).result).toMatchObject(
        { outcome: "blocked", executed: false },
      );
      rmSync(lock);
      writeFileSync(join(f.root, ".private.env"), "password=private-caller-only");
      writeFileSync(join(f.root, ".npmrc"), "private-caller-settings");
      writeFileSync(join(f.root, "failure.mjs"), "export const repairedButUncommitted = true;\n");
      const before = f.git("status", "--porcelain"),
        sourceBytes = readFileSync(join(f.root, "failure.mjs"));
      const reproduced = f.reproduce(
        original.runId,
        "--execute",
        "--workspace",
        prepared.result.workspaceId,
        "--env",
        "CANARY_FIXTURE_TOKEN",
      );
      expect(reproduced.result, reproduced.stderr).toMatchObject({
        executed: true,
        outcome: "reproduced",
        exitCode: 1,
        processExit: 1,
        sourceRunId: original.runId,
        sourceManifestHash: parentHash,
        rootCauseConfirmed: false,
      });
      expect(f.git("status", "--porcelain")).toBe(before);
      expect(readFileSync(join(f.root, "failure.mjs"))).toEqual(sourceBytes);
      expect(readFileSync(join(f.root, ".private.env"), "utf8")).toBe("password=private-caller-only");
      expect(existsSync(join(isolated, ".private.env"))).toBe(false);
      expect(existsSync(join(isolated, ".npmrc"))).toBe(false);
      expect(readFileSync(join(isolated, "home.txt"), "utf8")).toContain(prepared.result.workspaceId);
      const integrity = f.repository.verify(reproduced.result.runId);
      expect(integrity.status).toBe("verified");
      const snapshot = f.repository.readRun(reproduced.result.runId)!;
      expect(snapshot.evidence?.lineage).toEqual({ replayOf: original.runId, parentManifestHash: parentHash });
      expect(snapshot.evidence?.reproduction.gitCommit).toBe(
        f.repository.readRun(original.runId)!.evidence!.reproduction.gitCommit,
      );
      expect(snapshot.checks?.[0]?.stdout).not.toContain("fixture-private-value");
      expect(snapshot.checks?.[0]?.envAllowlist).not.toContain("CANARY_UNDECLARED_TOKEN");
      expect(reproduced.stdout).not.toContain("fixture-private-value");
      const bundle = f.repository.readJson(reproduced.result.runId, "reproduction.json");
      expect(bundle).toMatchObject({ outcome: "reproduced", forwardedEnvironmentNames: ["CANARY_FIXTURE_TOKEN"] });
      const sourceFile = original.artifactPath,
        saved = readFileSync(sourceFile);
      writeFileSync(sourceFile, "{}");
      expect(f.reproduce(original.runId, "--execute").code).toBe(5);
      writeFileSync(sourceFile, saved);
      expect(sha256(readFileSync(sourceFile))).toBe(sha256(saved));
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  }, 90000);

  it("records blocked conditions without execution, verifies explicit service/data acknowledgement and rejects unsafe argv", () => {
    const f = fixture({
      requiredEnvironment: ["CANARY_FIXTURE_TOKEN"],
      services: ["fixture-service"],
      data: ["fixture-data"],
    });
    try {
      const original = f.original();
      const blocked = f.reproduce(original.runId, "--execute");
      expect(blocked.code).toBe(4);
      expect(blocked.result).toMatchObject({ outcome: "blocked", executed: false });
      expect(blocked.result.reasons).toHaveLength(3);
      expect(f.repository.verify(blocked.result.runId).status).toBe("verified");
      expect(existsSync(join(f.root, ".canary", "reproductions"))).toBe(false);
      const denied = f.reproduce(original.runId, "--execute", "--env", "CANARY_UNDECLARED_TOKEN");
      expect(denied.result.reasons.join()).toContain("not permitted");
      const acknowledged = f.reproduce(
        original.runId,
        "--execute",
        "--env",
        "CANARY_FIXTURE_TOKEN",
        "--ack-service",
        "fixture-service",
        "--ack-data",
        "fixture-data",
      );
      expect(acknowledged.result.outcome).toBe("reproduced");
      expect(f.reproduce(original.runId, "--prepare", "--execute").code).toBe(2);
      expect(f.reproduce(original.runId, "--execute", "--workspace", "../../outside").code).toBe(2);
      expect(f.reproduce(original.runId, "--execute", "--env", "TOKEN=private").code).toBe(2);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  }, 90000);

  it("blocks missing dependencies, changed prepared source and runs captured with dirty tracked source", () => {
    const f = fixture(undefined, { "fixture-dependency": "1.0.0" });
    try {
      const original = f.original();
      const prepared = f.reproduce(original.runId, "--prepare");
      expect(prepared.result.conditions.join()).toContain("dependencies");
      const missing = f.reproduce(original.runId, "--execute", "--workspace", prepared.result.workspaceId);
      expect(missing.result).toMatchObject({ outcome: "blocked", executed: false });
      writeFileSync(join(prepared.result.projectRoot, "failure.mjs"), "changed source\n");
      const changed = f.reproduce(original.runId, "--execute", "--workspace", prepared.result.workspaceId);
      expect(changed.result.executed).toBe(false);
      mkdirSync(join(f.root, "node_modules"));
      writeFileSync(join(f.root, "failure.mjs"), "throw new Error('uncommitted failure');\n");
      const dirty = f.original();
      const rejected = f.reproduce(dirty.runId, "--execute");
      expect(rejected.result.reasons.join()).toContain("Clean tracked source");
      expect(rejected.result.executed).toBe(false);
      writeFileSync(
        join(f.root, "package.json"),
        JSON.stringify({ name: "canary-reproduction-fixture", private: true }),
      );
      writeFileSync(
        join(f.root, "failure.mjs"),
        "import { writeFileSync } from 'node:fs'; writeFileSync('failure.mjs', 'changed during execution'); throw new Error('self-modifying check');\n",
      );
      f.git("add", ".");
      f.git("commit", "-qm", "Self-modifying check fixture");
      const selfModifying = f.original();
      const sourceChanged = f.reproduce(selfModifying.runId, "--execute");
      expect(sourceChanged.result).toMatchObject({
        outcome: "source-changed",
        executed: true,
        sourceUnchanged: false,
        exitCode: 5,
      });
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  }, 90000);
});
