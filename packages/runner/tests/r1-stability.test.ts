import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RunIsolationError,
  acquireRunLock,
  assertExclusiveTempDir,
  createExecutionWorkspace,
  pidAlive,
  readCheckpoint,
  recoverPartialRun,
  releaseRunLock,
  reservePort,
  runExecution,
  waitForExit,
  writeCheckpoint,
} from "../src/index.js";

const options = (cwd: string, entry = "agent.mjs") => ({
  cwd,
  entry,
  input: "ok" as unknown,
  runId: "run_test",
  caseId: "case",
  timeoutMs: 2000,
  coverage: { rootDir: cwd, include: [entry] },
});

describe("R1 status, budget and non-zero exit", () => {
  it("classifies a non-zero child exit as error without touching other dirs", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-r1-exit-"));
    writeFileSync(join(cwd, "agent.mjs"), "export default async () => { process.exit(7); };", "utf8");
    const result = await runExecution({ ...options(cwd), timeoutMs: 4000 });
    expect(result.passed).toBe(false);
    expect(result.failureCategory).toBe("runtime_error");
    expect(result.trajectory?.termination).toBe("error");
    expect(String(result.assertions[0]?.message)).toMatch(/exited with code 7/);
  });

  it("stops on maxToolCalls and records budget_exceeded", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-r1-budget-"));
    writeFileSync(
      join(cwd, "agent.mjs"),
      "export default async (_input, ctx) => { ctx.emit({ type: 'tool.call', name: 'a', cost: 1 }); await new Promise(() => {}); };",
      "utf8",
    );
    const result = await runExecution({ ...options(cwd), maxToolCalls: 0, timeoutMs: 4000, killGraceMs: 80 });
    expect(result.passed).toBe(false);
    expect(result.trajectory?.termination).toBe("budget_exceeded");
    expect(result.failureCategory).toBe("budget_exceeded");
  }, 15_000);

  it("passes when budget_exceeded is the expected termination", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-r1-budget-ok-"));
    writeFileSync(
      join(cwd, "agent.mjs"),
      "export default async (_input, ctx) => { ctx.emit({ type: 'tool.call', name: 'a', cost: 2 }); await new Promise(() => {}); };",
      "utf8",
    );
    const result = await runExecution({
      ...options(cwd),
      maxBudget: 1,
      timeoutMs: 4000,
      killGraceMs: 80,
      testCase: { id: "case", input: "ok", assertions: [{ type: "execution.termination", expected: "budget_exceeded" }] },
    });
    expect(result.passed).toBe(true);
    expect(result.trajectory?.termination).toBe("budget_exceeded");
    expect(result.failureCategory).toBeUndefined();
  }, 15_000);
});

describe("R1 descendant termination", () => {
  it("times out a hanging agent that spawned a grandchild and releases both pids", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "canary-r1-tree-"));
    const pidFile = join(cwd, "grand.pid");
    writeFileSync(
      join(cwd, "agent.mjs"),
      `import { spawn } from "node:child_process"; import { writeFileSync } from "node:fs";
export default async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{}, 1000)"], { stdio: "ignore", windowsHide: true });
  writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));
  await new Promise(() => {});
};`,
      "utf8",
    );
    const result = await runExecution({ ...options(cwd), timeoutMs: 400, killGraceMs: 120 });
    expect(result.failureCategory).toBe("timeout");
    expect(result.trajectory?.termination).toBe("timeout");
    const grand = Number(readFileSync(pidFile, "utf8"));
    expect(grand).toBeGreaterThan(0);
    expect(await waitForExit(grand, 5_000)).toBe(true);
    expect(pidAlive(grand)).toBe(false);
  }, 20_000);
});

describe("R1 temp, env, port and lock isolation", () => {
  it("gives concurrent workspaces distinct tmp, env and ports", async () => {
    const root = mkdtempSync(join(tmpdir(), "canary-r1-ws-"));
    const a = createExecutionWorkspace({ artifactDir: join(root, "run_a"), runId: "run_a" });
    const b = createExecutionWorkspace({ artifactDir: join(root, "run_b"), runId: "run_b" });
    const portA = await a.reservePort();
    const portB = await b.reservePort();
    expect(a.tmpDir).not.toBe(b.tmpDir);
    expect(a.env.CANARY_TMPDIR).toBe(a.tmpDir);
    expect(b.env.CANARY_TMPDIR).toBe(b.tmpDir);
    expect(a.env.CANARY_RUN_ID).toBe("run_a");
    expect(portA.port).not.toBe(portB.port);
    writeFileSync(join(a.tmpDir, "marker.txt"), "a", "utf8");
    writeFileSync(join(b.tmpDir, "marker.txt"), "b", "utf8");
    expect(readFileSync(join(a.tmpDir, "marker.txt"), "utf8")).toBe("a");
    expect(readFileSync(join(b.tmpDir, "marker.txt"), "utf8")).toBe("b");
    await a.release();
    await b.release();
  });

  it("classifies a preferred port conflict", async () => {
    const held = await reservePort();
    await expect(reservePort("127.0.0.1", held.port)).rejects.toMatchObject({ code: "PORT_CONFLICT" });
    await held.release();
  });

  it("classifies a live lock held by a different runId without replacing it", () => {
    const dir = mkdtempSync(join(tmpdir(), "canary-r1-held-"));
    const lockPath = join(dir, "run.lock");
    acquireRunLock(lockPath, { runId: "run_first", pid: process.pid, createdAt: new Date().toISOString() });
    try {
      expect(() => acquireRunLock(lockPath, { runId: "run_second", pid: process.pid, createdAt: new Date().toISOString() })).toThrow(RunIsolationError);
      try {
        acquireRunLock(lockPath, { runId: "run_second", pid: process.pid, createdAt: new Date().toISOString() });
      } catch (error) {
        expect((error as RunIsolationError).code).toBe("RUN_LOCK_HELD");
      }
      const record = JSON.parse(readFileSync(lockPath, "utf8")) as { runId: string };
      expect(record.runId).toBe("run_first");
    } finally {
      releaseRunLock(lockPath);
    }
  });

  it("reclaims leftover child pids when the workspace is released", async () => {
    const dir = mkdtempSync(join(tmpdir(), "canary-r1-reap-"));
    const workspace = createExecutionWorkspace({ artifactDir: join(dir, "run_reap"), runId: "run_reap" });
    const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore", windowsHide: true });
    expect(child.pid).toBeTruthy();
    workspace.recordChildPid(child.pid!);
    await workspace.release();
    expect(await waitForExit(child.pid!, 5_000)).toBe(true);
    expect(pidAlive(child.pid!)).toBe(false);
    expect(existsSync(join(dir, "run_reap", "run.lock"))).toBe(false);
  }, 10_000);

  it("rejects a duplicate live lock without overwriting the first lock record", () => {
    const dir = mkdtempSync(join(tmpdir(), "canary-r1-lock-"));
    const lockPath = join(dir, "run.lock");
    const first = acquireRunLock(lockPath, { runId: "run_dup", pid: process.pid, createdAt: new Date().toISOString() });
    expect(first.stale).toBe(false);
    expect(() => acquireRunLock(lockPath, { runId: "run_dup", pid: process.pid, createdAt: new Date().toISOString() })).toThrow(RunIsolationError);
    const record = JSON.parse(readFileSync(lockPath, "utf8")) as { runId: string; pid: number };
    expect(record.runId).toBe("run_dup");
    expect(record.pid).toBe(process.pid);
    releaseRunLock(lockPath);
  });

  it("reclaims a leftover lock from a dead pid", async () => {
    const dir = mkdtempSync(join(tmpdir(), "canary-r1-stale-"));
    const lockPath = join(dir, "run.lock");
    const zombie = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 30000)"], { stdio: "ignore", windowsHide: true });
    expect(zombie.pid).toBeTruthy();
    acquireRunLock(lockPath, { runId: "run_stale", pid: zombie.pid!, createdAt: new Date().toISOString() });
    zombie.kill("SIGKILL");
    expect(await waitForExit(zombie.pid!, 5_000)).toBe(true);
    const reclaimed = acquireRunLock(lockPath, { runId: "run_stale", pid: process.pid, createdAt: new Date().toISOString() });
    expect(reclaimed.stale).toBe(true);
    releaseRunLock(lockPath);
  }, 15_000);

  it("classifies a live temp-dir owner conflict", async () => {
    const dir = mkdtempSync(join(tmpdir(), "canary-r1-tmp-"));
    const holder = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore", windowsHide: true });
    writeFileSync(join(dir, ".owner.json"), JSON.stringify({ runId: "run_other", pid: holder.pid }), "utf8");
    try {
      expect(() => assertExclusiveTempDir(dir, "run_self")).toThrow(RunIsolationError);
      try {
        assertExclusiveTempDir(dir, "run_self");
      } catch (error) {
        expect((error as RunIsolationError).code).toBe("TMPDIR_CONFLICT");
      }
    } finally {
      if (holder.pid) {
        spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
        holder.kill("SIGKILL");
        await waitForExit(holder.pid, 4_000);
      }
    }
  }, 10_000);
});

describe("R1 checkpoint and partial recovery", () => {
  it("recovers a crashed run without dropping completed results", async () => {
    const artifactDir = mkdtempSync(join(tmpdir(), "canary-r1-ckpt-"));
    const snapshot = {
      runId: "run_partial",
      status: "running" as const,
      startedAt: new Date().toISOString(),
      totalCases: 2,
      completedCases: 1,
      passedCases: 1,
      results: [
        {
          runId: "run_partial",
          executionId: "exec_done",
          caseId: "done",
          passed: true,
          assertions: [{ id: "agent.completed", passed: true }],
          coverage: {
            runId: "run_partial",
            sourceHash: "x",
            status: "unavailable" as const,
            lines: { covered: 0, total: 0, pct: 0 },
            statements: { covered: 0, total: 0, pct: 0 },
            functions: { covered: 0, total: 0, pct: 0 },
            branches: { covered: 0, total: 0, pct: 0 },
            featureChains: [],
          },
        },
      ],
      events: [],
    };
    writeFileSync(join(artifactDir, "run.json"), JSON.stringify(snapshot, null, 2), "utf8");
    writeCheckpoint({
      v: 1,
      kind: "canary.checkpoint",
      runId: "run_partial",
      pid: 2147483647,
      status: "running",
      startedAt: snapshot.startedAt,
      updatedAt: snapshot.startedAt,
      artifactDir,
      tmpDir: join(artifactDir, "tmp"),
      workDir: join(artifactDir, "work"),
      lockPath: join(artifactDir, "run.lock"),
      ports: [],
      childPids: [],
      completedCaseKeys: ["done"],
      pendingCaseKeys: ["pending"],
    });
    const recovered = await recoverPartialRun(artifactDir, snapshot);
    expect(recovered.checkpoint.status).toBe("recovered");
    expect(recovered.checkpoint.recoveryOf).toBe("run_partial");
    expect(recovered.snapshot?.status).toBe("cancelled");
    expect(recovered.snapshot?.results).toHaveLength(1);
    expect(recovered.snapshot?.results[0]?.caseId).toBe("done");
    expect(recovered.snapshot?.results[0]?.passed).toBe(true);
    const disk = JSON.parse(readFileSync(join(artifactDir, "run.json"), "utf8")) as { results: unknown[] };
    expect(disk.results).toHaveLength(1);
    expect(readCheckpoint(artifactDir)?.status).toBe("recovered");
    expect(existsSync(join(artifactDir, "run.lock"))).toBe(false);
  });
});
