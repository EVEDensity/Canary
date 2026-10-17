import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { runCommandDetailed } from "../src/index.js";
import { CliFailure, classifyCiError, executeCi } from "../src/ci.js";
import { readCheckpoint, recoverStaleRuns, writeCheckpoint, RunRecoveryError } from "@canary/runner";
import { resolveProjectContext } from "../src/home.js";
import { ArtifactPrivacyError, beginArtifacts, FileArtifactRepository, sealArtifacts } from "@canary/trace";

function writeProject(cwd: string, agent: string): void {
  writeFileSync(join(cwd, "agent.mjs"), agent, "utf8");
  writeFileSync(
    join(cwd, "cases.ts"),
    "export default [{ id: 'one', input: 'alpha' }, { id: 'two', input: 'beta' }];",
    "utf8",
  );
  writeFileSync(
    join(cwd, "canary.config.ts"),
    `export default { agent: { adapter: 'function', entry: './agent.mjs' }, cases: './cases.ts', coverage: { include: ['agent.mjs'], exclude: [] }, reporters: ['json'], web: { host: '127.0.0.1', open: false } };`,
    "utf8",
  );
}

const isolatedRoots: string[] = [];

it("classifies recovery blockers with actionable fixed messages and preserves artifact failure exits", () => {
  const context = resolveProjectContext();
  for (const code of [
    "RUN_RECOVERY_LIVE_OWNER",
    "RUN_RECOVERY_UNPROVEN_PROCESS",
    "RUN_RECOVERY_CHECKPOINT",
    "RUN_RECOVERY_PATH",
  ] as const) {
    const result = classifyCiError(new RunRecoveryError(code, "private runtime exception"), context);
    expect(result.code).toBe(code);
    expect(result.exitCode).toBe(
      code === "RUN_RECOVERY_LIVE_OWNER" || code === "RUN_RECOVERY_UNPROVEN_PROCESS" ? 4 : 5,
    );
    expect(result.message).not.toContain("private runtime exception");
    expect(result.suggestion).toContain("do not remove locks");
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of isolatedRoots.splice(0)) {
    const path = relative(realpathSync.native(tmpdir()), root);
    if (!path || path.startsWith("..") || isAbsolute(path)) throw new Error("Unsafe CI partial fixture cleanup");
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
});
function partialProject() {
  const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-r31-ci-partial-")));
  isolatedRoots.push(cwd);
  writeProject(cwd, "export default async (input) => ({ value: input });");
  return cwd;
}
function partialRun(cwd: string, runId: string, mismatch = false) {
  const artifactDir = join(cwd, ".canary", "artifacts", runId),
    startedAt = new Date().toISOString();
  const metric = { covered: 0, total: 0, pct: 0 };
  beginArtifacts(artifactDir);
  const snapshot = {
    runId: mismatch ? "run_wrong_identity" : runId,
    status: "running",
    startedAt,
    totalCases: 2,
    completedCases: 1,
    passedCases: 1,
    events: [],
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
          status: "unavailable",
          lines: metric,
          statements: metric,
          functions: metric,
          branches: metric,
          featureChains: [],
        },
      },
    ],
  };
  writeFileSync(join(artifactDir, "run.json"), JSON.stringify(snapshot, null, 2));
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
    childPids: [process.pid],
    completedCaseKeys: ["one"],
    pendingCaseKeys: ["two"],
  });
  return artifactDir;
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
    const leftSnap = JSON.parse(readFileSync(left.artifactPath, "utf8")) as {
      results: Array<{ output: { tmp: string; value: string } }>;
    };
    const rightSnap = JSON.parse(readFileSync(right.artifactPath, "utf8")) as {
      results: Array<{ output: { tmp: string; value: string } }>;
    };
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
    const leftSnap = JSON.parse(readFileSync(left.artifactPath, "utf8")) as {
      results: Array<{ output: { tmp: string } }>;
    };
    const rightSnap = JSON.parse(readFileSync(right.artifactPath, "utf8")) as {
      results: Array<{ output: { tmp: string } }>;
    };
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
    const completed = await runCommandDetailed({ cwd, headless: true, noOpen: true, caseId: "one" });
    expect(completed.exitCode).toBe(0);
    // Model a genuinely partial run; mutating an already sealed run is now an integrity failure.
    const first = {
      ...completed,
      runId: "run_interrupted",
      artifactPath: join(cwd, ".canary", "artifacts", "run_interrupted", "run.json"),
    };
    const artifactDir = join(cwd, ".canary", "artifacts", first.runId);
    beginArtifacts(artifactDir);
    const snapshot = JSON.parse(readFileSync(completed.artifactPath, "utf8"));
    snapshot.runId = first.runId;
    snapshot.results = snapshot.results.map((result: Record<string, unknown>) => ({ ...result, runId: first.runId }));
    snapshot.status = "running";
    delete snapshot.finishedAt;
    writeFileSync(first.artifactPath, JSON.stringify(snapshot, null, 2), "utf8");
    writeFileSync(
      join(artifactDir, "checkpoint.json"),
      JSON.stringify(
        {
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
        },
        null,
        2,
      ),
      "utf8",
    );
    const repository = new FileArtifactRepository(join(cwd, ".canary", "artifacts"));
    const recovered = await recoverStaleRuns(join(cwd, ".canary", "artifacts"), (runId) => repository.readRun(runId));
    expect(recovered.some((item) => item.checkpoint.runId === first.runId)).toBe(true);
    const after = JSON.parse(readFileSync(first.artifactPath, "utf8")) as {
      status: string;
      recoveryOf?: string;
      results: unknown[];
    };
    expect(after.status).toBe("cancelled");
    expect(after.recoveryOf).toBe(first.runId);
    expect(after.results).toHaveLength(1);
  }, 20_000);

  it("associates a mid-run CI throw with the partial checkpoint and ci.json", async () => {
    const cwd = partialProject();
    const runId = "run_partial_crash";
    const artifactDir = join(cwd, ".canary", "artifacts", runId);
    let original = "",
      manifest = "";
    const signal = vi.spyOn(process, "kill");
    const result = await executeCi(["--ci", "--config", resolve(cwd, "canary.config.ts")], async () => {
      partialRun(cwd, runId);
      mkdirSync(join(artifactDir, "tmp"));
      mkdirSync(join(artifactDir, "work"));
      writeFileSync(join(artifactDir, "tmp", "raw.txt"), "unfinished worker data");
      writeFileSync(join(artifactDir, "run.lock"), "original lock observation");
      original = readFileSync(join(artifactDir, "run.json"), "utf8");
      manifest = readFileSync(join(artifactDir, "manifest.json"), "utf8");
      throw new Error("simulated runner crash");
    });
    expect(result.exitCode).toBe(10);
    expect(result.runId).toBe(runId);
    expect(result.artifactPath).toBe(join(artifactDir, "run.json"));
    expect(result.summary).toEqual({ total: 2, passed: 1, failed: 0 });
    expect(readFileSync(join(artifactDir, "run.json"), "utf8")).toBe(original);
    expect(readFileSync(join(artifactDir, "manifest.json"), "utf8")).toBe(manifest);
    expect(new FileArtifactRepository(join(cwd, ".canary", "artifacts")).verify(runId).status).toBe("partial");
    expect(JSON.parse(readFileSync(join(artifactDir, "ci.json"), "utf8"))).toEqual(result);
    expect(readCheckpoint(artifactDir)).toMatchObject({
      status: "interrupted",
      termination: "error",
      pid: process.pid,
      childPids: [process.pid],
    });
    expect(readFileSync(join(artifactDir, "tmp", "raw.txt"), "utf8")).toBe("unfinished worker data");
    expect(readFileSync(join(artifactDir, "run.lock"), "utf8")).toBe("original lock observation");
    expect(existsSync(join(artifactDir, "work"))).toBe(true);
    expect(existsSync(join(artifactDir, "recovery.json"))).toBe(false);
    expect(signal).not.toHaveBeenCalled();
  });

  it("preserves the original interrupted outcome and does not associate an earlier checkpoint owned by this PID", async () => {
    const cwd = partialProject(),
      previous = partialRun(cwd, "run_previous");
    const oldCheckpoint = readFileSync(join(previous, "checkpoint.json"), "utf8");
    let current = "";
    const result = await executeCi(["--config", join(cwd, "canary.config.ts")], async () => {
      current = partialRun(cwd, "run_current");
      throw new CliFailure(
        3,
        "RUN_INTERRUPTED",
        "The requested run was interrupted.",
        "Inspect retained partial evidence before retrying.",
      );
    });
    expect(result).toMatchObject({ exitCode: 3, outcome: "interrupted", runId: "run_current" });
    expect(result.issues[0]!.code).toBe("RUN_INTERRUPTED");
    expect(readCheckpoint(current)).toMatchObject({ status: "interrupted", termination: "cancelled" });
    expect(JSON.parse(readFileSync(join(current, "ci.json"), "utf8"))).toEqual(result);
    expect(readFileSync(join(previous, "checkpoint.json"), "utf8")).toBe(oldCheckpoint);
    expect(existsSync(join(previous, "ci.json"))).toBe(false);
  });

  it("reports a signalled AbortError as interrupted while retaining completed cases and the partial manifest", async () => {
    const cwd = partialProject();
    let dir = "";
    const result = await executeCi(["--config", join(cwd, "canary.config.ts")], async (options) => {
      dir = partialRun(cwd, "run_signal_abort");
      // Exercise this invocation's installed stop handler without sending a real process signal.
      const stop = process.listeners("SIGTERM").at(-1)!;
      stop();
      expect(options.signal!.aborted).toBe(true);
      throw new DOMException("private aborted worker message", "AbortError");
    });
    expect(result).toMatchObject({ exitCode: 3, outcome: "interrupted", summary: { total: 2, passed: 1, failed: 0 } });
    expect(readCheckpoint(dir)).toMatchObject({ status: "interrupted", termination: "cancelled" });
    expect(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")).state).toBe("partial");
    expect(JSON.parse(readFileSync(join(dir, "ci.json"), "utf8"))).toEqual(result);
    expect(JSON.stringify(result)).not.toContain("private aborted worker message");
  });

  it("associates an already sealed failed run without recovery and adds its CI envelope through a normal manifest revision", async () => {
    const cwd = partialProject(),
      runId = "run_sealed_failure";
    let dir = "",
      original = "",
      checkpointBytes = "",
      manifestHash = "";
    const signal = vi.spyOn(process, "kill");
    const result = await executeCi(["--config", join(cwd, "canary.config.ts")], async () => {
      dir = partialRun(cwd, runId);
      const snapshot = JSON.parse(readFileSync(join(dir, "run.json"), "utf8"));
      snapshot.status = "failed";
      snapshot.finishedAt = new Date().toISOString();
      snapshot.totalCases = 1;
      snapshot.passedCases = 0;
      snapshot.results[0].passed = false;
      snapshot.results[0].assertions[0].passed = false;
      writeFileSync(join(dir, "run.json"), JSON.stringify(snapshot));
      writeCheckpoint({ ...readCheckpoint(dir)!, status: "failed", pendingCaseKeys: [], termination: "error" });
      sealArtifacts(dir);
      original = readFileSync(join(dir, "run.json"), "utf8");
      checkpointBytes = readFileSync(join(dir, "checkpoint.json"), "utf8");
      manifestHash = new FileArtifactRepository(join(cwd, ".canary", "artifacts")).verify(runId).manifestHash!;
      throw new ArtifactPrivacyError();
    });
    expect(result).toMatchObject({ exitCode: 6, outcome: "error", runId, summary: { total: 1, passed: 0, failed: 1 } });
    expect(result.issues[0]!.code).toBe("ARTIFACT_PRIVACY");
    expect(JSON.parse(readFileSync(join(dir, "ci.json"), "utf8"))).toEqual(result);
    expect(readFileSync(join(dir, "run.json"), "utf8")).toBe(original);
    expect(readFileSync(join(dir, "checkpoint.json"), "utf8")).toBe(checkpointBytes);
    expect(readCheckpoint(dir)!.status).toBe("failed");
    expect(JSON.parse(original).recoveryOf).toBeUndefined();
    expect(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")).previousManifestHash).toBe(manifestHash);
    expect(new FileArtifactRepository(join(cwd, ".canary", "artifacts")).verify(runId).status).toBe("verified");
    expect(existsSync(join(dir, "recovery.json"))).toBe(false);
    expect(signal).not.toHaveBeenCalled();
  });

  it.each(["completed", "checkpoint-running"] as const)("refuses a sealed %s run as failure evidence", async (mode) => {
    const cwd = partialProject();
    let dir = "",
      checkpointBytes = "";
    const result = await executeCi(["--config", join(cwd, "canary.config.ts")], async () => {
      dir = partialRun(cwd, "run_sealed_other");
      const snapshot = JSON.parse(readFileSync(join(dir, "run.json"), "utf8"));
      snapshot.status = mode === "completed" ? "completed" : "failed";
      snapshot.finishedAt = new Date().toISOString();
      writeFileSync(join(dir, "run.json"), JSON.stringify(snapshot));
      if (mode === "completed") writeCheckpoint({ ...readCheckpoint(dir)!, status: "failed" });
      sealArtifacts(dir);
      checkpointBytes = readFileSync(join(dir, "checkpoint.json"), "utf8");
      throw new ArtifactPrivacyError();
    });
    expect(result).toMatchObject({ exitCode: 6, runId: null, artifactPath: null });
    expect(existsSync(join(dir, "ci.json"))).toBe(false);
    expect(readFileSync(join(dir, "checkpoint.json"), "utf8")).toBe(checkpointBytes);
  });

  it.each(["mismatch", "corrupt", "ambiguous"] as const)(
    "preserves a classified failure when checkpoint association is %s",
    async (mode) => {
      const cwd = partialProject();
      const result = await executeCi(["--config", join(cwd, "canary.config.ts")], async () => {
        const dir = partialRun(cwd, "run_untrusted", mode === "mismatch");
        if (mode === "corrupt") writeFileSync(join(dir, "checkpoint.json"), "{broken");
        if (mode === "ambiguous") partialRun(cwd, "run_other");
        throw new CliFailure(
          4,
          "FIXTURE_ENVIRONMENT",
          "The expected runtime is unavailable.",
          "Restore the fixture prerequisite.",
        );
      });
      expect(result).toMatchObject({ exitCode: 4, outcome: "error", runId: null, artifactPath: null });
      expect(result.issues[0]!.code).toBe("FIXTURE_ENVIRONMENT");
      expect(existsSync(join(cwd, ".canary", "artifacts", "run_untrusted", "ci.json"))).toBe(false);
    },
  );

  it("does not replace the original failure when partial ci.json cannot be written", async () => {
    const cwd = partialProject();
    const result = await executeCi(["--config", join(cwd, "canary.config.ts")], async () => {
      mkdirSync(join(partialRun(cwd, "run_envelope_blocked"), "ci.json"));
      throw new CliFailure(
        3,
        "RUN_INTERRUPTED",
        "The requested run was interrupted.",
        "Inspect retained partial evidence.",
      );
    });
    expect(result).toMatchObject({ exitCode: 3, outcome: "interrupted", runId: "run_envelope_blocked" });
    expect(result.issues[0]!.code).toBe("RUN_INTERRUPTED");
    expect(result.issues).toHaveLength(2);
    expect(readCheckpoint(join(cwd, ".canary", "artifacts", "run_envelope_blocked"))!.status).toBe("interrupted");
  });

  it("requires the documented Node 24 minimum before invoking a run", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(process.versions, "node")!;
    const run = vi.fn(async () => {
      throw new Error("Unsupported runtimes must never invoke the runner");
    });
    try {
      Object.defineProperty(process.versions, "node", { ...descriptor, value: "22.20.0" });
      const result = await executeCi([], run);
      expect(result).toMatchObject({ exitCode: 4, outcome: "error", runId: null });
      expect(result.issues[0]).toMatchObject({ code: "NODE_UNSUPPORTED", message: "Node 24 or later is required." });
      expect(run).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process.versions, "node", descriptor);
    }
  });
});
