import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runCommandDetailed } from "../src/index.js";
import { executeCi } from "../src/ci.js";
import { readCheckpoint, recoverStaleRuns, writeCheckpoint } from "@canary/runner";
import { FileArtifactRepository } from "@canary/trace";

function writeProject(cwd: string, agent: string): void {
  writeFileSync(join(cwd, "agent.mjs"), agent, "utf8");
  writeFileSync(join(cwd, "cases.ts"), "export default [{ id: 'one', input: 'alpha' }, { id: 'two', input: 'beta' }];", "utf8");
  writeFileSync(
    join(cwd, "canary.config.ts"),
    `export default { agent: { adapter: 'function', entry: './agent.mjs' }, cases: './cases.ts', coverage: { include: ['agent.mjs'], exclude: [] }, reporters: ['json'], web: { host: '127.0.0.1', open: false } };`,
    "utf8",
  );
}

describe("R1 concurrent runs and persisted checkpoints", () => {
  it("runs two projects concurrently without mixing tmp or artifacts", async () => {
    const agent = `import { writeFileSync } from "node:fs"; import { join } from "node:path";
export default async (input) => {
  const dir = process.env.CANARY_TMPDIR;
  writeFileSync(join(dir, String(input) + ".txt"), String(input));
  return { tmp: dir, value: input };
};`;
    const a = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-r1-conc-a-")));
    const b = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-r1-conc-b-")));
    writeProject(a, agent);
    writeProject(b, agent);
    const [left, right] = await Promise.all([
      runCommandDetailed({ cwd: a, headless: true, noOpen: true }),
      runCommandDetailed({ cwd: b, headless: true, noOpen: true }),
    ]);
    expect(left.exitCode).toBe(0);
    expect(right.exitCode).toBe(0);
    expect(left.runId).not.toBe(right.runId);
    const leftSnap = JSON.parse(readFileSync(left.artifactPath, "utf8")) as { results: Array<{ output: { tmp: string; value: string } }> };
    const rightSnap = JSON.parse(readFileSync(right.artifactPath, "utf8")) as { results: Array<{ output: { tmp: string; value: string } }> };
    const leftTmp = [...new Set(leftSnap.results.map((item) => item.output.tmp))];
    const rightTmp = [...new Set(rightSnap.results.map((item) => item.output.tmp))];
    expect(leftTmp).toHaveLength(1);
    expect(rightTmp).toHaveLength(1);
    expect(leftTmp[0]).not.toBe(rightTmp[0]);
    expect(leftTmp[0]?.includes(left.runId)).toBe(true);
    expect(rightTmp[0]?.includes(right.runId)).toBe(true);
    expect(existsSync(join(a, ".canary", "artifacts", right.runId))).toBe(false);
    expect(existsSync(join(b, ".canary", "artifacts", left.runId))).toBe(false);
  }, 30_000);

  it("writes a checkpoint for a cancelled partial run and keeps finished cases", async () => {
    const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-r1-partial-")));
    const doneFile = join(cwd, "ok.done");
    writeFileSync(
      join(cwd, "agent.mjs"),
      `import { writeFileSync } from "node:fs";
export default async (input) => {
  if (input === "stuck") return new Promise(() => {});
  writeFileSync(${JSON.stringify(doneFile)}, "ok");
  return { value: input };
};`,
      "utf8",
    );
    writeFileSync(
      join(cwd, "cases.ts"),
      "export default [{ id: 'ok', input: 'go' }, { id: 'stuck', input: 'stuck', options: { timeoutMs: 8000 } }];",
      "utf8",
    );
    writeFileSync(
      join(cwd, "canary.config.ts"),
      `export default { agent: { adapter: 'function', entry: './agent.mjs' }, cases: './cases.ts', coverage: { include: ['agent.mjs'], exclude: [] }, runtime: { concurrency: 1, timeoutMs: 8000 }, web: { host: '127.0.0.1', open: false } };`,
      "utf8",
    );
    const controller = new AbortController();
    const pending = runCommandDetailed({ cwd, headless: true, noOpen: true, signal: controller.signal });
    const deadline = Date.now() + 8_000;
    while (!existsSync(doneFile) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 40));
    expect(existsSync(doneFile)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 300));
    controller.abort();
    const result = await pending;
    expect(result.exitCode).toBe(1);
    const artifact = JSON.parse(readFileSync(result.artifactPath, "utf8")) as {
      status: string;
      results: Array<{ caseId: string; passed: boolean }>;
    };
    expect(artifact.status).toBe("cancelled");
    expect(artifact.results.some((item) => item.caseId === "ok" && item.passed)).toBe(true);
    expect(artifact.results.some((item) => item.caseId === "ok" && !item.passed)).toBe(false);
    const checkpoint = readCheckpoint(join(cwd, ".canary", "artifacts", result.runId));
    expect(checkpoint?.runId).toBe(result.runId);
    expect(["cancelled", "interrupted"]).toContain(checkpoint?.status);
    expect(checkpoint?.completedCaseKeys).toContain("ok");
  }, 20_000);

  it("runs the same project twice concurrently without sharing tmp or overwriting artifacts", async () => {
    const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-r1-same-")));
    writeProject(cwd, "export default async (input) => ({ value: input, tmp: process.env.CANARY_TMPDIR });");
    const [left, right] = await Promise.all([
      runCommandDetailed({ cwd, headless: true, noOpen: true }),
      runCommandDetailed({ cwd, headless: true, noOpen: true }),
    ]);
    expect(left.exitCode).toBe(0);
    expect(right.exitCode).toBe(0);
    expect(left.runId).not.toBe(right.runId);
    expect(existsSync(left.artifactPath)).toBe(true);
    expect(existsSync(right.artifactPath)).toBe(true);
    const leftSnap = JSON.parse(readFileSync(left.artifactPath, "utf8")) as { results: Array<{ output: { tmp: string } }> };
    const rightSnap = JSON.parse(readFileSync(right.artifactPath, "utf8")) as { results: Array<{ output: { tmp: string } }> };
    expect(leftSnap.results[0]?.output.tmp).not.toBe(rightSnap.results[0]?.output.tmp);
    expect(readFileSync(left.artifactPath, "utf8")).not.toBe("");
    expect(JSON.parse(readFileSync(left.artifactPath, "utf8")).runId).toBe(left.runId);
    expect(JSON.parse(readFileSync(right.artifactPath, "utf8")).runId).toBe(right.runId);
  }, 30_000);

  it("maps an aborted CI run to exit 3 and keeps the partial checkpoint", async () => {
    const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-r1-ci-abort-")));
    writeFileSync(join(cwd, "agent.mjs"), "export default async () => new Promise(() => {});", "utf8");
    writeFileSync(join(cwd, "cases.ts"), "export default [{ id: 'hang', input: 'x' }];", "utf8");
    writeFileSync(
      join(cwd, "canary.config.ts"),
      `export default { agent: { adapter: 'function', entry: './agent.mjs' }, cases: './cases.ts', coverage: { include: ['agent.mjs'], exclude: [] }, runtime: { timeoutMs: 8000 }, reporters: ['json'], web: { host: '127.0.0.1', open: false } };`,
      "utf8",
    );
    const controller = new AbortController();
    const pending = runCommandDetailed({ cwd, ci: true, signal: controller.signal });
    setTimeout(() => controller.abort(), 400);
    const result = await pending;
    expect(result.exitCode).toBe(3);
    expect(result.snapshot.status).toBe("cancelled");
    const checkpoint = readCheckpoint(join(cwd, ".canary", "artifacts", result.runId));
    expect(checkpoint?.runId).toBe(result.runId);
    expect(["cancelled", "interrupted"]).toContain(checkpoint?.status);
  }, 20_000);

  it("finalizes a stale running checkpoint on the next recover pass", async () => {
    const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-r1-recover-")));
    writeProject(cwd, "export default async (input) => ({ value: input });");
    const first = await runCommandDetailed({ cwd, headless: true, noOpen: true, caseId: "one" });
    expect(first.exitCode).toBe(0);
    const artifactDir = join(cwd, ".canary", "artifacts", first.runId);
    const snapshot = JSON.parse(readFileSync(first.artifactPath, "utf8"));
    snapshot.status = "running";
    delete snapshot.finishedAt;
    writeFileSync(first.artifactPath, JSON.stringify(snapshot, null, 2), "utf8");
    writeFileSync(
      join(artifactDir, "checkpoint.json"),
      JSON.stringify({
        v: 1,
        kind: "canary.checkpoint",
        runId: first.runId,
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
        completedCaseKeys: ["one"],
        pendingCaseKeys: ["two"],
      }, null, 2),
      "utf8",
    );
    const repository = new FileArtifactRepository(join(cwd, ".canary", "artifacts"));
    const recovered = await recoverStaleRuns(join(cwd, ".canary", "artifacts"), (runId) => repository.readRun(runId));
    expect(recovered.some((item) => item.checkpoint.runId === first.runId)).toBe(true);
    const after = JSON.parse(readFileSync(first.artifactPath, "utf8")) as { status: string; recoveryOf?: string; results: unknown[] };
    expect(after.status).toBe("cancelled");
    expect(after.recoveryOf).toBe(first.runId);
    expect(after.results).toHaveLength(1);
  }, 20_000);

  it("associates a mid-run CI throw with the partial checkpoint and ci.json", async () => {
    const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-r1-ci-recover-")));
    writeProject(cwd, "export default async (input) => ({ value: input });");
    const runId = "run_partial_crash";
    const artifactDir = join(cwd, ".canary", "artifacts", runId);
    mkdirSync(artifactDir, { recursive: true });
    const startedAt = new Date().toISOString();
    const snapshot = {
      runId,
      status: "running" as const,
      startedAt,
      totalCases: 2,
      completedCases: 1,
      passedCases: 1,
      results: [
        {
          runId,
          executionId: "exec_done",
          caseId: "one",
          passed: true,
          assertions: [{ id: "agent.completed", passed: true }],
          coverage: {
            runId,
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
      runId,
      pid: process.pid,
      status: "running",
      startedAt,
      updatedAt: startedAt,
      artifactDir,
      tmpDir: join(artifactDir, "tmp"),
      workDir: join(artifactDir, "work"),
      lockPath: join(artifactDir, "run.lock"),
      ports: [],
      childPids: [],
      completedCaseKeys: ["one"],
      pendingCaseKeys: ["two"],
    });
    const result = await executeCi(["--ci", "--config", resolve(cwd, "canary.config.ts")], async () => {
      throw new Error("simulated runner crash");
    });
    expect(result.exitCode).toBe(10);
    expect(result.runId).toBe(runId);
    expect(result.artifactPath).toBe(join(artifactDir, "run.json"));
    expect(result.summary).toEqual({ total: 2, passed: 1, failed: 0 });
    expect(JSON.parse(readFileSync(join(artifactDir, "run.json"), "utf8")).recoveryOf).toBe(runId);
    expect(JSON.parse(readFileSync(join(artifactDir, "ci.json"), "utf8")).runId).toBe(runId);
    expect(readCheckpoint(artifactDir)?.status).toBe("recovered");
  });
});
