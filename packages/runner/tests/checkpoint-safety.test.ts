import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { beginArtifacts, sealArtifacts, writePrivateJson } from "@canary/trace";
import type { RunSnapshot } from "@canary/core";
import {
  listCheckpoints,
  readCheckpoint,
  recoverPartialRun,
  recoverStaleRuns,
  writeCheckpoint,
  type RunCheckpoint,
} from "../src/checkpoint.js";
import { pidAlive } from "../src/index.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    const path = resolve(root),
      parent = realpathSync.native(tmpdir()),
      scope = relative(parent, path);
    if (!scope || scope.startsWith("..") || !path.includes("canary-checkpoint-safety-"))
      throw new Error("Unexpected test cleanup scope");
    rmSync(path, { recursive: true, force: true });
  }
});
function fixture() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-checkpoint-safety-")));
  roots.push(root);
  const dir = join(root, "run_interrupted"),
    now = new Date().toISOString();
  mkdirSync(dir);
  const checkpoint: RunCheckpoint = {
    v: 1,
    kind: "canary.checkpoint",
    runId: "run_interrupted",
    pid: 0,
    status: "running",
    startedAt: now,
    updatedAt: now,
    artifactDir: dir,
    tmpDir: join(dir, "tmp"),
    workDir: join(dir, "work"),
    lockPath: join(dir, "run.lock"),
    ports: [],
    childPids: [],
    completedCaseKeys: ["done"],
    pendingCaseKeys: ["pending"],
  };
  const snapshot = {
    runId: checkpoint.runId,
    status: "running",
    startedAt: now,
    totalCases: 2,
    completedCases: 1,
    passedCases: 1,
    results: [
      {
        runId: checkpoint.runId,
        executionId: "exec_done",
        caseId: "done",
        passed: true,
        assertions: [{ id: "ok", passed: true }],
      },
    ],
    events: [],
  } as RunSnapshot;
  beginArtifacts(dir);
  writePrivateJson(join(dir, "run.json"), snapshot);
  writeCheckpoint(checkpoint);
  return { root, dir, checkpoint, snapshot };
}
function replaceCheckpoint(dir: string, value: unknown) {
  writeFileSync(join(dir, "checkpoint.json"), JSON.stringify(value));
}
async function liveChild(): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["-e", "process.stdout.write('ready');setInterval(()=>{},1000)"], {
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  });
  await new Promise<void>((accept, reject) => {
    child.once("error", reject);
    child.stdout!.once("data", () => accept());
  });
  return child;
}

describe("checkpoint recovery ownership and containment", () => {
  it("finalizes a dead-owner partial run without killing or replaying any process", async () => {
    const { dir, checkpoint, snapshot } = fixture();
    writeCheckpoint({ ...checkpoint, childPids: [2_147_483_647] });
    const recovered = await recoverPartialRun(dir, snapshot);
    expect(recovered.killedPids).toEqual([]);
    expect(recovered.leftoverPids).toEqual([]);
    expect(recovered.snapshot?.results).toEqual(snapshot.results);
    expect(recovered.snapshot?.status).toBe("cancelled");
    expect(readCheckpoint(dir)?.status).toBe("recovered");
    expect(existsSync(join(dir, "run.lock"))).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, "recovery.json"), "utf8")).killedPids).toEqual([]);
  });

  it("blocks a live owner including the current process without changing evidence", async () => {
    const { dir, checkpoint, snapshot } = fixture();
    writeCheckpoint({ ...checkpoint, pid: process.pid });
    const before = readFileSync(join(dir, "checkpoint.json"), "utf8");
    await expect(recoverPartialRun(dir, snapshot)).rejects.toMatchObject({ code: "RUN_RECOVERY_LIVE_OWNER" });
    expect(readFileSync(join(dir, "checkpoint.json"), "utf8")).toBe(before);
    expect(existsSync(join(dir, "recovery.json"))).toBe(false);
  });

  it("never signals a live PID claimed by an unproven checkpoint", async () => {
    const { dir, checkpoint, snapshot } = fixture(),
      child = await liveChild();
    try {
      writeCheckpoint({ ...checkpoint, childPids: [child.pid!] });
      await expect(recoverPartialRun(dir, snapshot)).rejects.toMatchObject({ code: "RUN_RECOVERY_UNPROVEN_PROCESS" });
      expect(pidAlive(child.pid!)).toBe(true);
      expect(existsSync(join(dir, "recovery.json"))).toBe(false);
      expect(existsSync(join(dir, "run.lock"))).toBe(false);
    } finally {
      child.kill("SIGKILL");
      await new Promise<void>((done) => child.once("close", () => done()));
    }
  });

  it.each(["artifactDir", "tmpDir", "workDir", "lockPath"])(
    "rejects forged %s before modifying a sibling directory",
    async (field) => {
      const { root, dir, checkpoint, snapshot } = fixture(),
        outside = join(root, "outside");
      mkdirSync(outside);
      const marker = join(outside, "run.lock");
      writeFileSync(marker, "keep");
      replaceCheckpoint(dir, { ...checkpoint, [field]: field === "lockPath" ? marker : outside });
      await expect(recoverStaleRuns(root, () => snapshot)).rejects.toMatchObject({ code: "RUN_RECOVERY_PATH" });
      expect(readFileSync(marker, "utf8")).toBe("keep");
      expect(existsSync(join(outside, "recovery.json"))).toBe(false);
      expect(existsSync(join(dir, "recovery.json"))).toBe(false);
    },
  );

  it.each([
    { pid: -1 },
    { childPids: ["123"] },
    { childPids: [0] },
    { ports: [65536] },
    { completedCaseKeys: "done" },
    { startedAt: "yesterday" },
    { executionGranted: true },
    { runId: "../outside" },
  ])("rejects malformed checkpoint fields: %j", (change) => {
    const { dir, checkpoint } = fixture();
    replaceCheckpoint(dir, { ...checkpoint, ...change });
    expect(() => readCheckpoint(dir)).toThrow(/Checkpoint|identity/);
  });

  it("rejects mismatched directory identity and snapshot identity", async () => {
    const { dir, checkpoint, snapshot } = fixture();
    replaceCheckpoint(dir, { ...checkpoint, runId: "run_other" });
    expect(() => readCheckpoint(dir)).toThrow(/identity/);
    replaceCheckpoint(dir, checkpoint);
    await expect(recoverPartialRun(dir, { ...snapshot, runId: "run_other" })).rejects.toMatchObject({
      code: "RUN_RECOVERY_CHECKPOINT",
    });
  });

  it("blocks missing, truncated and oversized checkpoints rather than deriving recovery authority", async () => {
    const { dir, snapshot } = fixture(),
      file = join(dir, "checkpoint.json");
    rmSync(file);
    await expect(recoverPartialRun(dir, snapshot)).rejects.toMatchObject({ code: "RUN_RECOVERY_CHECKPOINT" });
    writeFileSync(file, '{"v":1');
    expect(() => readCheckpoint(dir)).toThrow(/Checkpoint/);
    writeFileSync(file, " ".repeat(2_097_153));
    expect(() => readCheckpoint(dir)).toThrow(/Checkpoint/);
    expect(existsSync(join(dir, "recovery.json"))).toBe(false);
  });

  it("rejects a linked checkpoint and a linked run directory", () => {
    const { root, dir } = fixture(),
      file = join(dir, "checkpoint.json"),
      alias = join(root, "alias.json");
    linkSync(file, alias);
    expect(() => readCheckpoint(dir)).toThrow(/Checkpoint/);
    const linked = join(root, "run_linked");
    symlinkSync(dir, linked, process.platform === "win32" ? "junction" : "dir");
    expect(() => readCheckpoint(linked)).toThrow(/ordinary run directory/);
  });

  it("rejects a redirected workspace before creating a recovery lock or deleting its target", async () => {
    const { root, dir, snapshot } = fixture(),
      outside = join(root, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "keep.txt"), "keep");
    symlinkSync(outside, join(dir, "tmp"), process.platform === "win32" ? "junction" : "dir");
    await expect(recoverPartialRun(dir, snapshot)).rejects.toThrow(/ordinary directories/);
    expect(readFileSync(join(outside, "keep.txt"), "utf8")).toBe("keep");
    expect(existsSync(join(dir, "run.lock"))).toBe(false);
  });

  it("leaves finalized run evidence unchanged", async () => {
    const { root, dir, checkpoint, snapshot } = fixture();
    writeCheckpoint({ ...checkpoint, status: "completed" });
    sealArtifacts(dir);
    const before = readFileSync(join(dir, "manifest.json"), "utf8");
    await expect(recoverPartialRun(dir, snapshot)).rejects.toMatchObject({ code: "RUN_RECOVERY_FINALIZED" });
    expect(await recoverStaleRuns(root, () => snapshot)).toEqual([]);
    expect(readFileSync(join(dir, "manifest.json"), "utf8")).toBe(before);
    expect(listCheckpoints(root)).toHaveLength(1);
  });
});
