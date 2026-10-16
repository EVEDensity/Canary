import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { FileArtifactRepository, stableHash } from "@canary/trace";
import { runCommandDetailed } from "../src/index.js";
import { projectSourceInventory } from "../src/discovery.js";
import { executionSourceReasons, sourceFingerprint } from "../src/source-identity.js";

const roots: string[] = [];
afterEach(() => {
  const parent = realpathSync.native(tmpdir());
  for (const root of roots.splice(0)) {
    const path = relative(parent, root);
    if (!isAbsolute(root) || isAbsolute(path) || path === ".." || path.startsWith("..\\") || path.startsWith("../"))
      throw new Error("Unsafe test cleanup root");
    rmSync(root, { recursive: true, force: true });
  }
});
function fixture() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-source-identity-")));
  roots.push(root);
  return root;
}
function plan(project: string) {
  const file = join(project, "canary.project.json");
  writeFileSync(
    file,
    JSON.stringify({
      kind: "canary.project",
      version: 1,
      checks: [{ id: "test", type: "command", command: "node", args: ["-e", "process.exit(0)"] }],
    }),
  );
  return file;
}
describe("sealed execution source identity", () => {
  it("preserves successful ordinary runs without Git and declines source proof", async () => {
    const root = fixture();
    const run = await runCommandDetailed({
      cwd: root,
      configPath: plan(root),
      headless: true,
      noOpen: true,
      suppressOutput: true,
    });
    const repository = new FileArtifactRepository(join(root, ".canary", "artifacts"));
    expect(run.exitCode).toBe(0);
    expect(repository.verify(run.runId).status).toBe("verified");
    const proof = repository.readJson(run.runId, "execution-source.json");
    expect(proof).toMatchObject({ v: 1, kind: "canary.execution-source", runId: run.runId, status: "unavailable" });
    expect(executionSourceReasons(proof, run.snapshot, "Candidate")).toContain(
      "Candidate execution source proof is unavailable or incomplete",
    );
  });
  it("binds monorepo inventory to the run project while fingerprinting every tracked input", async () => {
    const root = fixture(),
      project = join(root, "packages", "example");
    mkdirSync(project, { recursive: true });
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
    git("init", "-q");
    git("config", "user.name", "Canary fixture");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "core.autocrlf", "false");
    writeFileSync(join(root, ".gitignore"), ".canary/\n");
    writeFileSync(join(root, "outside-input.txt"), "retained input\n");
    writeFileSync(join(project, "input.mjs"), "export default 'project';\n");
    const configPath = plan(project);
    git("add", ".");
    git("commit", "-qm", "monorepo fixture");
    const run = await runCommandDetailed({
      cwd: project,
      configPath,
      headless: true,
      noOpen: true,
      suppressOutput: true,
    });
    const repository = new FileArtifactRepository(join(project, ".canary", "artifacts"));
    const proof = repository.readJson<Record<string, unknown>>(run.runId, "execution-source.json")!;
    expect(run.exitCode).toBe(0);
    expect(proof).toMatchObject({
      status: "unchanged",
      projectPath: "packages/example",
      before: { sourceHash: run.snapshot.evidence!.reproduction.sourceHash, commitMatches: true },
      after: { commitMatches: true },
    });
    expect(executionSourceReasons(proof, run.snapshot, "Candidate")).toEqual([]);
    expect(run.snapshot.evidence!.reproduction.sourceHash).toBe(stableHash(projectSourceInventory(project)));
    expect(run.snapshot.evidence!.reproduction.sourceHash).not.toBe(stableHash(projectSourceInventory(root)));
    const before = sourceFingerprint(project, project);
    writeFileSync(join(root, "outside-input.txt"), "changed tracked input\n");
    const after = sourceFingerprint(project, project);
    expect(after.sourceHash).toBe(before.sourceHash);
    expect(after.trackedFilesHash).not.toBe(before.trackedFilesHash);
    expect(after.commitMatches).toBe(false);
    expect(executionSourceReasons({ ...proof, runId: "other-run" }, run.snapshot, "Candidate")).not.toEqual([]);
    expect(executionSourceReasons({ ...proof, projectPath: "." }, run.snapshot, "Candidate")).not.toEqual([]);
    expect(executionSourceReasons(undefined, run.snapshot, "Candidate")).not.toEqual([]);
  }, 20_000);
  it("rejects unchanged hidden tracked inputs even when Git status and the check are green", async () => {
    const root = fixture();
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
    git("init", "-q");
    git("config", "user.name", "Canary fixture");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "core.autocrlf", "false");
    writeFileSync(join(root, ".gitignore"), ".canary/\n");
    writeFileSync(join(root, "fixture.txt"), "original\n");
    const configPath = join(root, "canary.project.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        kind: "canary.project",
        version: 1,
        checks: [
          {
            id: "test",
            type: "command",
            command: "node",
            args: [
              "-e",
              "const fs=require('node:fs');console.log(JSON.stringify({v:1,kind:'canary.assertions',method:'deterministic',results:[{id:'actual',passed:fs.readFileSync('fixture.txt','utf8')==='mutated\\n'}]}))",
            ],
          },
        ],
        contracts: [{ id: "behavior", paths: ["fixture.txt"], checkId: "test", assertionId: "actual", required: true }],
      }),
    );
    git("add", ".");
    git("commit", "-qm", "tracked input fixture");
    expect(sourceFingerprint(root).commitMatches).toBe(true);
    git("update-index", "--assume-unchanged", "fixture.txt");
    writeFileSync(join(root, "fixture.txt"), "mutated\n");
    expect(git("status", "--porcelain", "--untracked-files=no")).toBe("");
    const hidden = sourceFingerprint(root);
    expect(hidden.commitMatches).toBe(false);
    const run = await runCommandDetailed({ cwd: root, configPath, headless: true, noOpen: true, suppressOutput: true });
    expect(run.exitCode).toBe(0);
    expect(run.snapshot.evidence!.reproduction.gitDirty).toBe(false);
    const repository = new FileArtifactRepository(join(root, ".canary", "artifacts"));
    const proof = repository.readJson<{ before: Record<string, unknown>; after: Record<string, unknown> }>(
      run.runId,
      "execution-source.json",
    )!;
    expect(proof).toMatchObject({
      status: "unchanged",
      before: { commitMatches: false },
      after: { commitMatches: false },
    });
    expect(executionSourceReasons(proof, run.snapshot, "Candidate")).toEqual([
      "Candidate execution source proof tracked inputs do not match the recorded commit",
    ]);
    const legacy = structuredClone(proof);
    delete legacy.before.commitMatches;
    delete legacy.after.commitMatches;
    expect(executionSourceReasons(legacy, run.snapshot, "Historical")).toEqual([]);
    legacy.before.extra = true;
    expect(executionSourceReasons(legacy, run.snapshot, "Candidate")).toEqual([
      "Candidate execution source proof is unavailable or incomplete",
    ]);
  }, 20_000);
  it("accepts CRLF worktree bytes when Git text canonicalization matches the retained commit", () => {
    const root = fixture();
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
    git("init", "-q");
    git("config", "user.name", "Canary fixture");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "core.autocrlf", "false");
    writeFileSync(join(root, ".gitattributes"), "fixture.txt text eol=crlf\n");
    writeFileSync(join(root, "fixture.txt"), "original\nsecond\n");
    git("add", ".");
    git("commit", "-qm", "canonical text fixture");
    writeFileSync(join(root, "fixture.txt"), "original\r\nsecond\r\n");
    const canonical = sourceFingerprint(root);
    expect(canonical.commitMatches).toBe(true);
    // Identical worktree bytes do not establish the commit if the index was replaced.
    writeFileSync(join(root, "fixture.txt"), "staged\r\nsecond\r\n");
    git("add", "fixture.txt");
    writeFileSync(join(root, "fixture.txt"), "original\r\nsecond\r\n");
    expect(sourceFingerprint(root).commitMatches).toBe(false);
    git("reset", "-q", "HEAD", "--", "fixture.txt");
    expect(sourceFingerprint(root).commitMatches).toBe(true);
    const hash = git("rev-parse", "HEAD:fixture.txt");
    execFileSync("git", ["update-index", "--index-info"], {
      cwd: root,
      input: `0 ${"0".repeat(hash.length)}\tfixture.txt\n100644 ${hash} 1\tfixture.txt\n100644 ${hash} 2\tfixture.txt\n100644 ${hash} 3\tfixture.txt\n`,
    });
    expect(sourceFingerprint(root).commitMatches).toBe(false);
  }, 20_000);
});
