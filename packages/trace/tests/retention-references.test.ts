import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { qualityContentHash, type ImprovementPlan, type RunLineage } from "@canary/core";
import {
  applyRetention,
  beginArtifacts,
  createImprovementSession,
  executeImprovementSession,
  FileArtifactRepository,
  planRetention,
  readQualityAssessment,
  recordQualityDecision,
  sealArtifacts,
  writePrivateJson,
} from "../src/index.js";
import * as artifacts from "../src/artifacts.js";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    if (resolve(root).startsWith(resolve(tmpdir(), "canary-r31-retention-")))
      rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "canary-r31-retention-"));
  roots.push(root);
  const repository = new FileArtifactRepository(root);
  const run = (id: string, lineage: RunLineage = {}, startedAt = "2026-01-01T00:00:00Z") => {
    const dir = join(root, id);
    beginArtifacts(dir, lineage);
    writePrivateJson(join(dir, "run.json"), {
      runId: id,
      status: "failed",
      startedAt,
      finishedAt: "2026-10-18T00:00:00Z",
      totalCases: 0,
      completedCases: 0,
      passedCases: 0,
      results: [],
      events: [],
      evidence: { v: 1, lineage },
      checks: [
        {
          id: "behavior",
          type: "command",
          version: 1,
          required: true,
          status: "failed",
          evidence: "verified",
          exitCode: 1,
          category: "assertion",
          retryable: true,
          durationMs: 1,
          cwd: ".",
          envAllowlist: [],
        },
      ],
    });
    sealArtifacts(dir);
    return dir;
  };
  run("baseline");
  run("obsolete", {}, "2025-01-01T00:00:00Z");
  const choose = (runId = "baseline") => {
    const view = readQualityAssessment(repository, runId),
      option = view.report.options.find((item) => item.action === "repair-behavior")!;
    return recordQualityDecision(repository, runId, {
      reportHash: view.report.contentHash,
      expectedRevision: view.revision,
      optionId: option.id,
      action: "select",
      actor: "maintainer",
      reason: "Verify the fixed behavior",
    });
  };
  const prepare = () => {
    const view = choose(),
      plan: ImprovementPlan = {
        v: 1,
        kind: "canary.improvement-plan",
        id: `improvement_${randomUUID()}`,
        projectId: view.report.projectId,
        createdAt: new Date().toISOString(),
        baseline: view.report.binding,
        selection: {
          reportHash: view.report.contentHash,
          expectedRevision: view.revision,
          optionId: view.selections[0]!.optionId,
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
    return createImprovementSession(repository, plan);
  };
  const qualityFile = () =>
    join(
      root,
      ".quality",
      readdirSync(join(root, ".quality")).find((name) => name.endsWith(".json"))!,
    );
  return { root, repository, run, choose, prepare, qualityFile };
}

describe("R31 reference-preserving retention", () => {
  it("keeps retained choices and their lineage while independently removing unreferenced evidence", () => {
    const f = fixture();
    f.run("decision", { replayOf: "baseline" }, "2026-02-01T00:00:00Z");
    f.choose("decision");
    const before = readFileSync(f.qualityFile()),
      plan = planRetention(f.root, { maxRuns: 0 });
    expect(plan.candidates).toEqual(["obsolete"]);
    expect(plan.protectedRuns).toEqual(expect.arrayContaining(["decision", "baseline"]));
    expect(plan.withinBudget).toBe(false);
    expect(applyRetention(f.root, plan)).toEqual(["obsolete"]);
    expect(readFileSync(f.qualityFile())).toEqual(before);
    expect(f.repository.verify("baseline").status).toBe("verified");
    expect(f.repository.verify("decision").status).toBe("verified");
  });
  it("protects the baseline of an unexecuted prepared session independently from choices", () => {
    const f = fixture(),
      session = f.prepare();
    unlinkSync(f.qualityFile());
    const plan = planRetention(f.root, { maxRuns: 0 });
    expect(session.attempts).toEqual([]);
    expect(plan.candidates).toEqual(["obsolete"]);
    expect(plan.protectedRuns).toContain("baseline");
    expect(applyRetention(f.root, plan)).toEqual(["obsolete"]);
    expect(existsSync(join(f.root, ".improvements", `${session.plan.id}.json`))).toBe(true);
  });
  it("protects a retained candidate even for a blocked attempt and preserves source evidence", async () => {
    const f = fixture(),
      session = f.prepare(),
      plan = session.plan;
    f.run("candidate", { candidateOf: "baseline", parentManifestHash: plan.baseline.manifestHash });
    await executeImprovementSession(
      f.repository,
      plan.id,
      { planHash: plan.contentHash, actor: "maintainer", reason: "Verify the candidate" },
      async () => ({
        status: "blocked",
        code: "FIXTURE_STOP",
        candidateRunId: "candidate",
        candidateManifestHash: f.repository.verify("candidate").manifestHash!,
        observed: { durationMs: 1, cases: 0, toolCalls: 0, managedLiveModelCalls: 0, monetaryCost: null },
      }),
    );
    const retention = planRetention(f.root, { maxRuns: 0 });
    expect(retention.candidates).toEqual(["obsolete"]);
    expect(retention.protectedRuns).toEqual(expect.arrayContaining(["baseline", "candidate"]));
    expect(applyRetention(f.root, retention)).toEqual(["obsolete"]);
    expect(f.repository.verify("candidate").status).toBe("verified");
  });
  it("rejects a stale deletion plan after new choices or session references appear", () => {
    const f = fixture(),
      plan = planRetention(f.root, { maxRuns: 0 });
    f.choose();
    expect(() => applyRetention(f.root, plan)).toThrow(/changed/);
    expect(existsSync(join(f.root, "baseline"))).toBe(true);
    expect(existsSync(join(f.root, "obsolete"))).toBe(true);
    const chosenPlan = planRetention(f.root, { maxRuns: 0 });
    f.prepare();
    expect(() => applyRetention(f.root, chosenPlan)).toThrow(/changed/);
    expect(existsSync(join(f.root, "obsolete"))).toBe(true);
  });
  it.each([
    "quality-corrupt",
    "quality-hash",
    "session-corrupt",
    "quality-lock",
    "session-lock",
    "recovery-guard",
    "catalog-lock",
    "incomplete-write",
  ])("fails closed for %s metadata", (fault) => {
    const f = fixture(),
      session = f.prepare(),
      quality = f.qualityFile(),
      prior = planRetention(f.root, { maxRuns: 0 });
    if (fault === "quality-corrupt") writeFileSync(quality, '{"v":');
    if (fault === "quality-hash") {
      const value = JSON.parse(readFileSync(quality, "utf8"));
      value.decisions[0].reason = "Changed after hashing";
      writeFileSync(quality, JSON.stringify(value));
    }
    if (fault === "session-corrupt") writeFileSync(join(f.root, ".improvements", `${session.plan.id}.json`), "{}");
    if (fault === "quality-lock") writeFileSync(`${quality}.lock`, "interrupted");
    if (fault === "session-lock")
      writeFileSync(join(f.root, ".improvements", `${session.plan.id}.json.lock`), "interrupted");
    if (fault === "recovery-guard")
      writeFileSync(
        join(f.root, ".improvements", `${session.plan.id}.json.recover.lock`),
        JSON.stringify({ pid: process.pid, nonce: randomUUID() }),
      );
    if (fault === "catalog-lock") writeFileSync(join(f.root, ".improvements", "catalog.lock"), "interrupted");
    if (fault === "incomplete-write") writeFileSync(`${quality}.${randomUUID()}.tmp`, '{"partial":');
    const blocked = planRetention(f.root, { maxRuns: 0 });
    expect(blocked.candidates).toEqual([]);
    expect(blocked.withinBudget).toBe(false);
    expect(blocked.blockers.length).toBeGreaterThan(0);
    expect(() => applyRetention(f.root, prior)).toThrow();
    expect(existsSync(join(f.root, "obsolete"))).toBe(true);
  });
  it.each(["nonce", "token"])("retains a %s owner lock and never treats its PID as permission to prune", (field) => {
    const f = fixture(),
      session = f.prepare(),
      plan = planRetention(f.root, { maxRuns: 0 }),
      lock = join(f.root, ".improvements", `${session.plan.id}.json.lock`),
      body = JSON.stringify({ pid: 2_000_000_000, [field]: randomUUID() });
    writeFileSync(lock, body);
    const blocked = planRetention(f.root, { maxRuns: 0 });
    expect(blocked.blockers).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "RETENTION_BUSY", store: ".improvements" })]),
    );
    expect(() => applyRetention(f.root, plan)).toThrow(/writer/);
    expect(readFileSync(lock, "utf8")).toBe(body);
    expect(existsSync(join(f.root, "obsolete"))).toBe(true);
  });
  it.each(["hard-link", "symbolic-link"])("rejects a %s reference record without deleting its target", (kind) => {
    const f = fixture();
    f.choose();
    const file = f.qualityFile(),
      bytes = readFileSync(file);
    let outside = join(f.root, "copy.json");
    if (kind === "hard-link") {
      writeFileSync(outside, bytes);
      unlinkSync(file);
      linkSync(outside, file);
    } else {
      const target = join(f.root, "linked_source");
      expect(resolve(target, "..")).toBe(resolve(f.root));
      renameSync(join(f.root, ".quality"), target);
      symlinkSync(target, join(f.root, ".quality"), process.platform === "win32" ? "junction" : "dir");
      outside = join(target, basename(file));
    }
    const plan = planRetention(f.root, { maxRuns: 0 });
    expect(plan.blockers[0]?.code).toBe("RETENTION_STORAGE");
    expect(plan.candidates).toEqual([]);
    expect(() => applyRetention(f.root, plan)).toThrow();
    expect(readFileSync(outside)).toEqual(bytes);
  });
  it("rejects new run references and changed manifests after a preview", () => {
    const f = fixture(),
      plan = planRetention(f.root, { maxRuns: 0 });
    f.run("new_referrer", { replayOf: "obsolete" });
    expect(() => applyRetention(f.root, plan)).toThrow(/changed/);
    expect(existsSync(join(f.root, "obsolete"))).toBe(true);
    const next = planRetention(f.root, { maxRuns: 0 });
    f.repository.writeJson("baseline", "derived.json", { retained: true });
    expect(() => applyRetention(f.root, next)).toThrow(/changed/);
  });
  it("keeps the dependencies of a run that becomes busy after preview", () => {
    const f = fixture();
    f.run("child", { replayOf: "baseline" }, "2026-02-01T00:00:00Z");
    const plan = planRetention(f.root, { maxRuns: 0 });
    writeFileSync(join(f.root, "child", "run.lock"), "active writer");
    expect(applyRetention(f.root, plan)).toEqual(["obsolete"]);
    expect(existsSync(join(f.root, "baseline"))).toBe(true);
    expect(existsSync(join(f.root, "child"))).toBe(true);
  });
  it("does not trust altered run metadata to remove a retained dependency", () => {
    const f = fixture();
    f.run("parent", {}, "2026-02-01T00:00:00Z");
    const file = join(f.root, "parent", "run.json"),
      value = JSON.parse(readFileSync(file, "utf8"));
    value.checks[0].childRun = {
      runId: "obsolete",
      artifactPath: join(f.root, "obsolete", "run.json"),
      manifestHash: f.repository.verify("obsolete").manifestHash,
    };
    writeFileSync(file, JSON.stringify(value));
    const plan = planRetention(f.root, { maxRuns: 0 });
    expect(plan.blockers).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "RETENTION_EVIDENCE", store: "parent" })]),
    );
    expect(plan.candidates).toEqual([]);
    expect(() => applyRetention(f.root, plan)).toThrow();
    expect(existsSync(join(f.root, "obsolete"))).toBe(true);
  });
  it("holds managed writer locks through deletion and releases them afterwards", () => {
    const f = fixture();
    const session = f.prepare();
    const plan = planRetention(f.root, { maxRuns: 0 }),
      original = artifacts.verifyArtifacts;
    let observed = false;
    vi.spyOn(artifacts, "verifyArtifacts").mockImplementation((dir, ancestors) => {
      if (basename(dir) === "obsolete" && existsSync(join(dir, "manifest.lock"))) {
        observed = true;
        const view = readQualityAssessment(f.repository, "baseline");
        expect(() =>
          recordQualityDecision(f.repository, "baseline", {
            reportHash: view.report.contentHash,
            expectedRevision: view.revision,
            optionId: view.report.options[0]!.id,
            action: "select",
            actor: "maintainer",
            reason: "Concurrent choice",
          }),
        ).toThrow(/writer/);
        expect(existsSync(join(f.root, ".improvements", "catalog.lock"))).toBe(true);
        const guard = JSON.parse(
          readFileSync(join(f.root, ".improvements", `${session.plan.id}.json.recover.lock`), "utf8"),
        );
        expect(guard).toMatchObject({ pid: process.pid, nonce: expect.stringMatching(/^[a-f0-9-]{36}$/) });
      }
      return original(dir, ancestors);
    });
    expect(applyRetention(f.root, plan)).toEqual(["obsolete"]);
    expect(observed).toBe(true);
    expect(readdirSync(join(f.root, ".quality")).some((name) => name.endsWith(".lock"))).toBe(false);
    expect(existsSync(join(f.root, ".improvements", "catalog.lock"))).toBe(false);
    expect(existsSync(join(f.root, ".improvements", `${session.plan.id}.json.recover.lock`))).toBe(false);
  });
  it("still deletes standalone unreferenced runs, preserving ordinary retention behavior", () => {
    const f = fixture(),
      plan = planRetention(f.root, { maxRuns: 0 });
    expect(plan.withinBudget).toBe(true);
    expect(plan.blockers).toEqual([]);
    expect(applyRetention(f.root, plan).sort()).toEqual(["baseline", "obsolete"]);
    expect(planRetention(f.root, { maxRuns: 0 }).withinBudget).toBe(true);
  });
});
