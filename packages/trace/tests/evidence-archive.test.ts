import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
  existsSync,
  linkSync,
  symlinkSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { parseArchiveManifest, qualityContentHash, type ImprovementPlan } from "@canary/core";
import {
  beginArtifacts,
  sealArtifacts,
  writePrivateJson,
  verifyArtifacts,
  sha256,
  FileArtifactRepository,
  readQualityAssessment,
  recordQualityDecision,
  createImprovementSession,
  planEvidenceArchive,
  createEvidenceArchive,
  readEvidenceArchive,
  planEvidenceRestore,
  restoreEvidenceArchive,
  withCollectionMutation,
  acquireCollectionLease,
  inspectCollectionLocks,
  recoverCollectionLocks,
} from "../src/index.js";
const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  for (const root of roots.splice(0)) {
    const rel = relative(realpathSync.native(tmpdir()), root);
    if (!rel || rel.startsWith("..") || !rel.startsWith("canary-archive-")) throw Error("Invalid cleanup target");
    rmSync(root, { recursive: true, force: true });
  }
});
function fixture(sessions = 1) {
  const workspace = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-archive-")));
  roots.push(workspace);
  const root = join(workspace, "artifacts"),
    target = join(workspace, "archives", "first"),
    repo = new FileArtifactRepository(root);
  const run = (
    runId: string,
    status = "completed",
    lineage: Record<string, string> = {},
    extra: Record<string, unknown> = {},
  ) => {
    const dir = join(root, runId);
    const metric = { covered: 0, total: 0, pct: 0 },
      coverage = {
        runId,
        sourceHash: "source",
        status: "final",
        lines: metric,
        branches: metric,
        functions: metric,
        statements: metric,
        files: [],
        featureChains: [],
      };
    beginArtifacts(dir, lineage);
    writePrivateJson(join(dir, "run.json"), {
      runId,
      status,
      startedAt: "2026-10-18T00:00:00Z",
      finishedAt: "2026-10-18T00:00:01Z",
      totalCases: 2,
      completedCases: 2,
      passedCases: status === "failed" ? 1 : 2,
      results: [
        {
          runId,
          executionId: "one",
          caseId: "fix",
          passed: status !== "failed",
          assertions: [{ id: "tool.called", passed: status !== "failed" }],
          coverage,
        },
        {
          runId,
          executionId: "two",
          caseId: "holdout",
          passed: true,
          assertions: [{ id: "tool.called", passed: true }],
          coverage,
        },
      ],
      events: [],
      ...extra,
    });
    sealArtifacts(dir);
    return dir;
  };
  run("run_baseline", "failed");
  run("run_candidate", "completed", {
    candidateOf: "run_baseline",
    parentManifestHash: verifyArtifacts(join(root, "run_baseline")).manifestHash!,
  });
  run(
    "run_parent",
    "completed",
    {},
    {
      checks: [
        {
          id: "agent",
          status: "passed",
          childRun: {
            runId: "run_candidate",
            artifactPath: join(root, "run_candidate", "run.json"),
            manifestHash: verifyArtifacts(join(root, "run_candidate")).manifestHash,
          },
        },
      ],
    },
  );
  const initial = readQualityAssessment(repo, "run_baseline"),
    option = initial.report.options.find((o) => o.action === "repair-behavior")!;
  const view = recordQualityDecision(repo, "run_baseline", {
    reportHash: initial.report.contentHash,
    expectedRevision: 0,
    optionId: option.id,
    action: "select",
    actor: "maintainer",
    reason: "Review the retained failure",
  });
  for (let i = 0; i < sessions; i++) {
    const plan: ImprovementPlan = {
      v: 1,
      kind: "canary.improvement-plan",
      id: `improvement_${randomUUID()}`,
      projectId: view.report.projectId,
      createdAt: new Date().toISOString(),
      baseline: view.report.binding,
      selection: {
        reportHash: view.report.contentHash,
        expectedRevision: view.revision,
        optionId: option.id,
        selectionRevision: view.selections[0]!.revision,
      },
      scope: {
        caseIds: ["fix", "holdout"],
        regressionCaseIds: ["fix"],
        holdoutCaseIds: ["holdout"],
        allowedPaths: ["candidate.mjs"],
        contractsHash: "1".repeat(64),
        trials: 2,
      },
      candidate: {
        configPath: "canary.config.json",
        configFileHash: "2".repeat(64),
        entry: "candidate.mjs",
        entryHash: "3".repeat(64),
        inventoryHash: "4".repeat(64),
      },
      budget: { maxRuns: 1, maxCases: 2, maxDurationMs: 1000, maxToolCalls: 2, maxLiveModelCalls: 0 },
      success: {
        requireRegressionImprovement: true,
        allowRegressions: false,
        requireHoldoutPass: true,
        minimumPairs: 5,
      },
      executionGranted: false,
      contentHash: "",
    };
    plan.contentHash = qualityContentHash(plan);
    createImprovementSession(repo, plan);
  }
  return { workspace, root, target, repo, run };
}
const request = (planHash: string) => ({
  planHash,
  actor: "maintainer",
  reason: "Preserve complete verified evidence",
});
function hashes(root: string) {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, name.name);
      if (name.isDirectory()) walk(file);
      else out[relative(root, file)] = sha256(readFileSync(file));
    }
  };
  walk(root);
  return out;
}
it.each(["copy", "rotate"] as const)("preserves all source bytes after a handled %s publication failure", (mode) => {
  const f = fixture(),
    before = hashes(f.root),
    plan = planEvidenceArchive(f.root, f.target, mode),
    rename = fs.renameSync,
    copy = fs.copyFileSync;
  if (mode === "rotate")
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to) === f.target) throw Error("Injected publication failure");
      return rename(from, to);
    });
  else
    vi.spyOn(fs, "copyFileSync").mockImplementation((from, to, flags) => {
      if (String(from).startsWith(f.root)) throw Error("Injected copy failure");
      return copy(from, to, flags);
    });
  syncBuiltinESMExports();
  expect(() => createEvidenceArchive(f.root, f.target, mode, request(plan.contentHash))).toThrow(/Injected/);
  expect(hashes(f.root)).toEqual(before);
  expect(existsSync(f.target)).toBe(false);
});
it("previews without writes and copies the complete decision/session/child evidence collection byte for byte", () => {
  const f = fixture(),
    before = hashes(f.root),
    plan = planEvidenceArchive(f.root, f.target);
  expect(plan).toMatchObject({
    mode: "copy",
    runs: 3,
    qualityRecords: 1,
    improvementSessions: 1,
    executionGranted: false,
  });
  expect(existsSync(join(f.workspace, "archives"))).toBe(false);
  expect(hashes(f.root)).toEqual(before);
  const receipt = createEvidenceArchive(f.root, f.target, "copy", request(plan.contentHash));
  expect(receipt.sourceReset).toBe(false);
  expect(hashes(f.root)).toEqual(before);
  const archive = readEvidenceArchive(f.root, f.target);
  expect(archive.files).toHaveLength(Object.keys(before).length);
  expect(hashes(join(f.target, "collection"))).toEqual(before);
  expect(() => planEvidenceRestore(f.root, f.target)).toThrow(/empty collection/);
});
it("rotates a full 64-session quota and restores exact records and original child paths without overwriting active evidence", () => {
  const f = fixture(64),
    before = hashes(f.root),
    plan = planEvidenceArchive(f.root, f.target, "rotate");
  expect(plan.improvementSessions).toBe(64);
  expect(createEvidenceArchive(f.root, f.target, "rotate", request(plan.contentHash)).sourceReset).toBe(true);
  expect(readdirSync(f.root)).toEqual([]);
  expect(readEvidenceArchive(f.root, f.target).improvementSessions).toBe(64);
  const restore = planEvidenceRestore(f.root, f.target);
  expect(restoreEvidenceArchive(f.root, f.target, request(restore.contentHash)).action).toBe("restore");
  expect(hashes(f.root)).toEqual(before);
  expect(verifyArtifacts(join(f.root, "run_parent")).status).toBe("verified");
  expect(readQualityAssessment(f.repo, "run_baseline").selections).toHaveLength(1);
  expect(readdirSync(join(f.root, ".improvements"))).toHaveLength(64);
  expect(() => restoreEvidenceArchive(f.root, f.target, request(restore.contentHash))).toThrow(/empty collection/);
}, 15000);
it("rejects stale review hashes, source drift, credentials and nested/existing destinations before moving evidence", () => {
  const f = fixture(),
    plan = planEvidenceArchive(f.root, f.target, "rotate"),
    before = hashes(f.root);
  expect(() => createEvidenceArchive(f.root, f.target, "rotate", request("0".repeat(64)))).toThrow(/changed/);
  expect(() =>
    createEvidenceArchive(f.root, f.target, "rotate", {
      ...request(plan.contentHash),
      reason: "password=fixture-credential-value",
    }),
  ).toThrow(/credentials/);
  expect(() => planEvidenceArchive(f.root, join(f.root, "nested"))).toThrow(/outside/);
  expect(() => planEvidenceArchive(f.root, f.workspace)).toThrow(/outside/);
  expect(hashes(f.root)).toEqual(before);
  f.run("run_added");
  expect(() => createEvidenceArchive(f.root, f.target, "rotate", request(plan.contentHash))).toThrow(/changed/);
  expect(existsSync(f.target)).toBe(false);
});
it.each(["tampered", "truncated", "extra", "linked"])(
  "blocks %s archive content and preserves the empty restore target",
  (mode) => {
    const f = fixture(),
      plan = planEvidenceArchive(f.root, f.target, "rotate");
    createEvidenceArchive(f.root, f.target, "rotate", request(plan.contentHash));
    const file = join(f.target, "collection", "run_baseline", "run.json");
    if (mode === "tampered") writeFileSync(file, readFileSync(file, "utf8").replace('"failed"', '"completed"'));
    if (mode === "truncated") writeFileSync(join(f.target, "archive.json"), '{"v":');
    if (mode === "extra") writeFileSync(join(f.target, "extra.json"), "{}");
    if (mode === "linked") {
      const other = join(f.workspace, "linked.json");
      writeFileSync(other, readFileSync(file));
      rmSync(file);
      linkSync(other, file);
    }
    expect(() => planEvidenceRestore(f.root, f.target)).toThrow();
    expect(readdirSync(f.root)).toEqual([]);
  },
);
it("refuses partial runs, missing lineage, residual locks and directory links without exporting incomplete evidence", () => {
  const f = fixture(),
    before = hashes(f.root);
  const release = acquireCollectionLease(f.root);
  try {
    expect(() => planEvidenceArchive(f.root, f.target)).toThrow(/active or interrupted/);
  } finally {
    release();
  }
  withCollectionMutation(f.root, () => {
    expect(() => beginArtifacts(join(f.root, "run_race"))).toThrow(/maintenance/);
    expect(() => f.repo.writeJson("run_baseline", "derived.json", { value: 1 })).toThrow(/maintenance/);
    const current = readQualityAssessment(f.repo, "run_baseline");
    expect(() =>
      recordQualityDecision(f.repo, "run_baseline", {
        reportHash: current.report.contentHash,
        expectedRevision: current.revision,
        optionId: current.report.options[0]!.id,
        action: "reject",
        actor: "maintainer",
        reason: "Inspect the competing writer",
      }),
    ).toThrow(/maintenance/);
  });
  expect(hashes(f.root)).toEqual(before);
  beginArtifacts(join(f.root, "run_partial"));
  expect(() => planEvidenceArchive(f.root, f.target)).toThrow();
  rmSync(join(f.root, "run_partial"), { recursive: true });
  f.run("run_missing", "completed", { retryOf: "run_absent" });
  expect(() => planEvidenceArchive(f.root, f.target)).toThrow(/missing/);
  rmSync(join(f.root, "run_missing"), { recursive: true });
  symlinkSync(f.workspace, join(f.root, "run_link"), "junction");
  expect(() => planEvidenceArchive(f.root, f.target)).toThrow(/Linked/);
  expect(existsSync(f.target)).toBe(false);
});
it("lets an independent writer enroll after a short real maintenance barrier without dropping its lease", async () => {
  const f = fixture(),
    code = `import{withCollectionMutation}from ${JSON.stringify(new URL("../dist/index.js", import.meta.url).href)};withCollectionMutation(${JSON.stringify(f.root)},()=>{process.send('entered');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,60);});`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
      windowsHide: true,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    }),
    closed = once(child, "close"),
    timer = setTimeout(() => child.kill(), 5000);
  try {
    await Promise.race([
      once(child, "message"),
      closed.then(() => {
        throw Error("Writer did not enter its barrier");
      }),
    ]);
    const release = acquireCollectionLease(f.root);
    try {
      expect(inspectCollectionLocks(f.root).locks).toHaveLength(1);
    } finally {
      release();
    }
    await closed;
    expect(planEvidenceArchive(f.root, f.target).runs).toBe(3);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
  }
}, 8000);
it("preserves the populated restore destination and rejects foreign artifact identity", () => {
  const f = fixture(),
    plan = planEvidenceArchive(f.root, f.target, "rotate");
  createEvidenceArchive(f.root, f.target, "rotate", request(plan.contentHash));
  const restore = planEvidenceRestore(f.root, f.target);
  f.run("run_new");
  const before = hashes(f.root);
  expect(() => restoreEvidenceArchive(f.root, f.target, request(restore.contentHash))).toThrow(/empty/);
  expect(hashes(f.root)).toEqual(before);
  const other = fixture(0);
  expect(() => readEvidenceArchive(other.root, f.target)).toThrow(/another artifact/);
});
it("rejects forged manifest hierarchy, duplicates and unknown fields", () => {
  const f = fixture(),
    p = planEvidenceArchive(f.root, f.target);
  createEvidenceArchive(f.root, f.target, "copy", request(p.contentHash));
  const manifest = readEvidenceArchive(f.root, f.target);
  for (const mutated of [
    { ...manifest, files: [...manifest.files, manifest.files[0]!] },
    { ...manifest, directories: [] },
    { ...manifest, files: [{ ...manifest.files[0]!, path: "../escaped.json" }] },
  ])
    expect(() => parseArchiveManifest({ ...mutated, contentHash: qualityContentHash(mutated) })).toThrow();
  expect(() => parseArchiveManifest({ ...manifest, execute: true })).toThrow();
});
it("keeps an interrupted pending archive fail closed", () => {
  const f = fixture(),
    before = hashes(f.root),
    pending = join(f.workspace, "pending");
  mkdirSync(pending);
  writeFileSync(join(pending, "archive.json"), '{"v":1}');
  expect(() => planEvidenceRestore(f.root, pending)).toThrow(/incomplete/);
  expect(hashes(f.root)).toEqual(before);
});
it("blocks a real live lease and explicitly releases only the unchanged dead-owner lease after process exit", async () => {
  const f = fixture();
  const code = `import {acquireCollectionLease} from ${JSON.stringify(new URL("../dist/index.js", import.meta.url).href)};acquireCollectionLease(${JSON.stringify(f.root)});process.send('leased');setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
      windowsHide: true,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    }),
    closed = once(child, "close"),
    timer = setTimeout(() => child.kill(), 8000);
  try {
    await Promise.race([
      once(child, "message"),
      closed.then(() => {
        throw Error("Lease owner exited early");
      }),
    ]);
    const live = inspectCollectionLocks(f.root);
    expect(live.locks[0]?.live).toBe(true);
    expect(() => recoverCollectionLocks(f.root, live.hash, "maintainer", "Inspect live operation")).toThrow();
    child.kill();
    await closed;
    const dead = inspectCollectionLocks(f.root);
    expect(dead.locks[0]?.live).toBe(false);
    expect(() => recoverCollectionLocks(f.root, "0".repeat(64), "maintainer", "Reject stale approval")).toThrow();
    recoverCollectionLocks(f.root, dead.hash, "maintainer", "Close dead fixture operation");
    expect(inspectCollectionLocks(f.root).locks).toEqual([]);
    expect(planEvidenceArchive(f.root, f.target).runs).toBe(3);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
  }
}, 12000);
