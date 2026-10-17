import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
  symlinkSync,
  linkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { qualityContentHash, type ImprovementPlan, type ImprovementAttemptResult } from "@canary/core";
import {
  beginArtifacts,
  sealArtifacts,
  writePrivateJson,
  FileArtifactRepository,
  readQualityAssessment,
  recordQualityDecision,
  createImprovementSession,
  readImprovementSession,
  listImprovementSessions,
  executeImprovementSession,
} from "../src/index.js";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    if (resolve(root).startsWith(resolve(tmpdir(), "canary-r30-store-")))
      rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "canary-r30-store-"));
  roots.push(root);
  const repo = new FileArtifactRepository(root),
    runId = "run_failure",
    dir = join(root, runId);
  beginArtifacts(dir);
  const metric = { covered: 0, total: 0, pct: 0 },
    coverage = {
      runId,
      sourceHash: "1".repeat(16),
      status: "final",
      lines: metric,
      branches: metric,
      functions: metric,
      statements: metric,
      files: [],
      featureChains: [],
    };
  writePrivateJson(join(dir, "run.json"), {
    runId,
    status: "failed",
    startedAt: "2026-10-18T00:00:00Z",
    totalCases: 2,
    completedCases: 2,
    passedCases: 1,
    results: [
      {
        runId,
        executionId: "exec_failure",
        caseId: "fix",
        passed: false,
        assertions: [{ id: "tool.called", passed: false }],
        coverage,
      },
      {
        runId,
        executionId: "exec_holdout",
        caseId: "holdout",
        passed: true,
        assertions: [{ id: "tool.called", passed: true }],
        coverage,
      },
    ],
    events: [],
  });
  sealArtifacts(dir);
  const initial = readQualityAssessment(repo, runId),
    option = initial.report.options.find((item) => item.action === "repair-behavior")!;
  const view = recordQualityDecision(repo, runId, {
    reportHash: initial.report.contentHash,
    expectedRevision: 0,
    optionId: option.id,
    action: "select",
    actor: "maintainer",
    reason: "Repair the recorded behavior",
  });
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
      configPath: "canary.config.ts",
      configFileHash: "2".repeat(64),
      entry: "candidate.mjs",
      entryHash: "3".repeat(64),
      inventoryHash: "4".repeat(64),
    },
    budget: { maxRuns: 1, maxCases: 2, maxDurationMs: 5000, maxToolCalls: 4, maxLiveModelCalls: 0 },
    success: { requireRegressionImprovement: true, allowRegressions: false, requireHoldoutPass: true, minimumPairs: 5 },
    executionGranted: false,
    contentHash: "",
  };
  plan.contentHash = qualityContentHash(plan);
  return {
    root,
    repo,
    plan,
    view,
    authorization: { planHash: plan.contentHash, actor: "maintainer", reason: "Verify the reviewed candidate" },
  };
}
const blocked = (): ImprovementAttemptResult => ({
  status: "blocked",
  code: "FIXTURE_STOP",
  observed: { durationMs: 1, cases: 0, toolCalls: 0, managedLiveModelCalls: 0, monetaryCost: null },
});
it("prepares an inert separate record and persists a charged attempt before invoking executable work", async () => {
  const { repo, root, plan, authorization } = fixture(),
    integrity = repo.verify(plan.baseline.runId);
  const prepared = createImprovementSession(repo, plan);
  expect(prepared.attempts).toEqual([]);
  expect(prepared.plan.executionGranted).toBe(false);
  expect(listImprovementSessions(repo, plan.baseline.runId)).toEqual([prepared]);
  const finished = await executeImprovementSession(repo, plan.id, authorization, async () => {
    const charged = readImprovementSession(repo, plan.id);
    expect(charged.attempts[0]?.state).toBe("running");
    expect(charged.revision).toBe(1);
    expect(existsSync(join(root, ".improvements", `${plan.id}.json.lock`))).toBe(true);
    return blocked();
  });
  expect(finished.revision).toBe(2);
  expect(finished.attempts[0]).toMatchObject({
    state: "finished",
    result: { status: "blocked", code: "FIXTURE_STOP" },
  });
  expect(repo.verify(plan.baseline.runId)).toEqual(integrity);
  const callback = vi.fn(async () => blocked());
  await expect(executeImprovementSession(repo, plan.id, authorization, callback)).rejects.toMatchObject({
    code: "IMPROVEMENT_BUDGET",
  });
  expect(callback).not.toHaveBeenCalled();
});
it("rejects concurrent writers, stale choices and a different plan hash before work", async () => {
  const { repo, plan, authorization, view } = fixture();
  createImprovementSession(repo, plan);
  let release!: () => void;
  const wait = new Promise<void>((done) => {
    release = done;
  });
  const running = executeImprovementSession(repo, plan.id, authorization, async () => {
    await wait;
    return { ...blocked(), observed: { ...blocked().observed, cases: 2, toolCalls: 2 } };
  });
  const callback = vi.fn(async () => blocked());
  await expect(executeImprovementSession(repo, plan.id, authorization, callback)).rejects.toMatchObject({
    code: "IMPROVEMENT_BUSY",
  });
  recordQualityDecision(repo, plan.baseline.runId, {
    reportHash: view.report.contentHash,
    expectedRevision: view.revision,
    optionId: plan.selection.optionId,
    action: "reject",
    actor: "maintainer",
    reason: "Withdraw the selected direction",
  });
  release();
  const stale = await running;
  expect(stale.attempts[0]?.result?.code).toBe("IMPROVEMENT_STALE");
  expect(stale.attempts[0]?.result?.observed).toMatchObject({ cases: 2, toolCalls: 2 });
  await expect(
    executeImprovementSession(repo, plan.id, { ...authorization, planHash: "f".repeat(64) }, callback),
  ).rejects.toMatchObject({ code: "IMPROVEMENT_STALE" });
  expect(callback).not.toHaveBeenCalled();
});
it("keeps interrupted claims consumed and rejects corrupt or secret-bearing records", async () => {
  const { repo, root, plan, authorization } = fixture();
  createImprovementSession(repo, plan);
  const file = join(root, ".improvements", `${plan.id}.json`),
    session = readImprovementSession(repo, plan.id);
  session.attempts = [
    { index: 1, executionRequest: authorization, state: "running", startedAt: new Date().toISOString() },
  ];
  session.revision = 1;
  session.contentHash = qualityContentHash(session);
  writeFileSync(file, JSON.stringify(session));
  const callback = vi.fn(async () => blocked());
  await expect(executeImprovementSession(repo, plan.id, authorization, callback)).rejects.toMatchObject({
    code: "IMPROVEMENT_BUSY",
  });
  expect(callback).not.toHaveBeenCalled();
  expect(readImprovementSession(repo, plan.id).attempts[0]?.state).toBe("running");
  const before = readFileSync(file);
  await expect(
    executeImprovementSession(
      repo,
      plan.id,
      { ...authorization, reason: "api_key=credential-sample-1234567890" },
      callback,
    ),
  ).rejects.toMatchObject({ code: "IMPROVEMENT_INPUT" });
  expect(readFileSync(file)).toEqual(before);
  writeFileSync(file, '{"partial":');
  expect(() => readImprovementSession(repo, plan.id)).toThrow(/corrupt/);
  await expect(executeImprovementSession(repo, plan.id, authorization, callback)).rejects.toMatchObject({
    code: "IMPROVEMENT_STORAGE",
  });
});
it("rejects unsupported stores, forged plan scope and partial source evidence", () => {
  const { repo, root, plan } = fixture();
  const invalid = { ...plan, scope: { ...plan.scope, holdoutCaseIds: ["fix"] } };
  invalid.contentHash = qualityContentHash(invalid);
  expect(() => createImprovementSession(repo, invalid)).toThrow(/complete/);
  mkdirSync(join(root, ".improvements"));
  writeFileSync(join(root, ".improvements", "unexpected.log"), "not session evidence");
  expect(() => createImprovementSession(repo, plan)).toThrow(/unsupported/);
  writeFileSync(join(root, plan.baseline.runId, "run.json"), "{}");
  expect(() => listImprovementSessions(repo, plan.baseline.runId)).toThrow();
});
it("rejects linked stores and shared records before reading or writing them", async () => {
  const one = fixture(),
    target = join(one.root, "external");
  mkdirSync(target);
  symlinkSync(target, join(one.root, ".improvements"), process.platform === "win32" ? "junction" : "dir");
  expect(() => createImprovementSession(one.repo, one.plan)).toThrow();
  const two = fixture();
  createImprovementSession(two.repo, two.plan);
  const file = join(two.root, ".improvements", `${two.plan.id}.json`),
    original = readFileSync(file);
  linkSync(file, join(two.root, "shared.json"));
  const callback = vi.fn(async () => blocked());
  await expect(executeImprovementSession(two.repo, two.plan.id, two.authorization, callback)).rejects.toThrow();
  expect(callback).not.toHaveBeenCalled();
  expect(readFileSync(file)).toEqual(original);
});
