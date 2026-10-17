import { afterAll, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  parseQualityAssessment,
  parseQualityRecord,
  qualityContentHash,
  type CoverageSummary,
  type RunSnapshot,
} from "@canary/core";
import { beginArtifacts, sealArtifacts, writePrivateJson } from "../src/artifacts.js";
import { FileArtifactRepository } from "../src/store.js";
import { readQualityAssessment, recordQualityDecision } from "../src/quality-assessment.js";
import { planRetention } from "../src/retention.js";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots)
    if (resolve(root).startsWith(resolve(tmpdir(), "canary-r29-"))) rmSync(root, { recursive: true, force: true });
});
function coverage(id = "run_quality"): CoverageSummary {
  return {
    runId: id,
    sourceHash: "1".repeat(64),
    status: "final",
    lines: { covered: 2, total: 2, pct: 100 },
    statements: { covered: 2, total: 2, pct: 100 },
    functions: { covered: 1, total: 1, pct: 100 },
    branches: { covered: 0, total: 0, pct: 0 },
    files: [],
    featureChains: [],
  };
}
function fixture(overrides: Partial<RunSnapshot> = {}, finalize = true) {
  const root = mkdtempSync(join(tmpdir(), "canary-r29-assessment-"));
  roots.push(root);
  const run: RunSnapshot = {
    runId: "run_quality",
    status: "failed",
    startedAt: "2026-10-17T00:00:00Z",
    finishedAt: "2026-10-17T00:00:01Z",
    totalCases: 2,
    completedCases: 2,
    passedCases: 0,
    results: [1, 2].map((n) => ({
      runId: "run_quality",
      caseId: "同一个用例 / repeated",
      executionId: `exec_${n}`,
      passed: false,
      failureCategory: "wrong_tool",
      assertions: [{ id: "tool.called#1", passed: false, message: "Tool lookup was not called" }],
      coverage: coverage(),
      metrics: { latencyMs: 10, steps: 1, toolCalls: 1 },
    })),
    events: [],
    coverage: coverage(),
    ...overrides,
  };
  const dir = join(root, run.runId);
  beginArtifacts(dir);
  writePrivateJson(join(dir, "run.json"), run);
  if (finalize) sealArtifacts(dir);
  const repository = new FileArtifactRepository(root);
  return { root, dir, run, repository };
}
function choice(view: ReturnType<typeof readQualityAssessment>, overrides = {}) {
  return {
    reportHash: view.report.contentHash,
    expectedRevision: view.revision,
    optionId: view.report.issues[0]!.recommendedOptionId,
    action: "select",
    actor: "maintainer",
    reason: "Inspect the recorded tool contract before editing",
    ...overrides,
  };
}

describe("R29 version-bound assessment and choices", () => {
  it("reuses sealed bytes without writing, separates repeated executions and keeps zero denominators unknown", () => {
    const { root, repository } = fixture(),
      before = repository.verify("run_quality");
    const a = readQualityAssessment(repository, "run_quality"),
      b = readQualityAssessment(repository, "run_quality");
    expect(a).toEqual(b);
    expect(existsSync(join(root, ".quality"))).toBe(false);
    expect(repository.verify("run_quality")).toEqual(before);
    expect(a.report.issues).toHaveLength(2);
    expect(new Set(a.report.issues.map((issue) => issue.id)).size).toBe(2);
    expect(a.report.issues[0]!.evidence[0]).toMatchObject({
      caseId: "同一个用例 / repeated",
      executionId: "exec_1",
      assertionId: "tool.called#1",
    });
    expect(a.report.coverage.find((metric) => metric.metric === "branches")).toEqual({
      metric: "branches",
      covered: 0,
      total: 0,
      pct: null,
    });
    expect(a.report.telemetry).toMatchObject({ modelTokens: null, monetaryCost: null, toolCalls: 2 });
    expect(a.untrustedEvidence).toBe(true);
  });
  it("records selection and rejection without changing evidence, and rejects stale revisions before writing", () => {
    const { root, repository } = fixture(),
      before = repository.verify("run_quality"),
      initial = readQualityAssessment(repository, "run_quality");
    const selected = recordQualityDecision(repository, "run_quality", choice(initial));
    expect(selected.revision).toBe(1);
    expect(selected.decisions[0]).toMatchObject({
      action: "select",
      executionGranted: false,
      verificationStatus: "not-executed",
      stale: false,
    });
    const file = join(
        root,
        ".quality",
        readdirSync(join(root, ".quality")).find((name) => name.endsWith(".json"))!,
      ),
      saved = readFileSync(file);
    expect(() => recordQualityDecision(repository, "run_quality", choice(initial))).toThrow(/revision changed/);
    expect(readFileSync(file)).toEqual(saved);
    const rejected = recordQualityDecision(
      repository,
      "run_quality",
      choice(selected, { action: "reject", reason: "Review the contract first" }),
    );
    expect(rejected.revision).toBe(2);
    expect(selected.selections[0]!.optionId).toBe(selected.decisions[0]!.optionId);
    expect(rejected.selections).toEqual([]);
    expect(repository.verify("run_quality")).toEqual(before);
    expect(parseQualityRecord(JSON.parse(readFileSync(file, "utf8"))).decisions).toHaveLength(2);
    const retention = planRetention(root, { maxRuns: 0 });
    expect(retention.candidates).toEqual([]);
    expect(retention.protectedRuns).toContain("run_quality");
  });
  it("keeps one current direction per issue while preserving superseded choices and opaque source identities", () => {
    const current = fixture({
      evidence: {
        v: 1,
        lineage: {},
        reproduction: {
          sourceHash: "a".repeat(16),
          casesHash: "cases-v1",
          configHash: "config-v1",
          node: "24",
          platform: "win32",
          arch: "x64",
          environmentHash: "env",
          environmentNames: [],
          lockfiles: {},
          mode: "recorded",
        },
      },
    });
    const initial = readQualityAssessment(current.repository, "run_quality");
    expect(initial.report.binding.sourceHash).toBe("a".repeat(16));
    const a = recordQualityDecision(current.repository, "run_quality", choice(initial));
    const b = recordQualityDecision(
      current.repository,
      "run_quality",
      choice(a, { optionId: a.report.options[1]!.id }),
    );
    expect(b.decisions).toHaveLength(2);
    expect(b.selections).toEqual([{ issueId: b.report.issues[0]!.id, optionId: b.report.options[1]!.id, revision: 2 }]);
    const rejectedOld = recordQualityDecision(current.repository, "run_quality", choice(b, { action: "reject" }));
    expect(rejectedOld.selections).toEqual(b.selections);
  });
  it("retains old report identities, marks their choices stale and requires a fresh selection after any manifest revision", () => {
    const { repository } = fixture(),
      initial = readQualityAssessment(repository, "run_quality");
    recordQualityDecision(repository, "run_quality", choice(initial));
    repository.writeJson("run_quality", "comparison.json", { note: "A legitimate derived artifact" });
    const changed = readQualityAssessment(repository, "run_quality");
    expect(changed.report.contentHash).not.toBe(initial.report.contentHash);
    expect(changed.decisions[0]!.stale).toBe(true);
    expect(() => recordQualityDecision(repository, "run_quality", choice(initial, { expectedRevision: 1 }))).toThrow(
      /refresh/,
    );
    expect(recordQualityDecision(repository, "run_quality", choice(changed)).revision).toBe(2);
  });
  it("does not treat partial, approximate or missing execution coverage as a precise percentage", () => {
    const partial = coverage();
    partial.status = "partial";
    const { repository } = fixture({ coverage: partial, completedCases: 1, passedCases: 0, results: [] });
    const report = readQualityAssessment(repository, "run_quality").report;
    expect(report.coverage.every((metric) => metric.pct === null)).toBe(true);
    expect(report.issues.some((issue) => issue.category === "unknown")).toBe(true);
    const precise = coverage();
    precise.files = [
      {
        filePath: "src/task.ts",
        sourceHash: "1".repeat(64),
        status: "final",
        quality: { precision: "approximate", mappingMode: "heuristic", diagnostics: [] },
        lines: { covered: 1, total: 2, pct: 50 },
        statements: precise.statements,
        functions: precise.functions,
        branches: precise.branches,
        uncoveredLocations: [{ filePath: "src/task.ts", start: { line: 9, column: 0 }, end: { line: 9, column: 1 } }],
      },
    ];
    const other = fixture({ coverage: precise });
    const uncertain = readQualityAssessment(other.repository, "run_quality").report;
    expect(uncertain.coverage.every((metric) => metric.pct === null)).toBe(true);
    expect(uncertain.issues.find((issue) => issue.origin === "coverage")!.evidence[0]!.line).toBeUndefined();
  });
  it("rejects corrupt or incomplete evidence, inconsistent counts and foreign execution identities", () => {
    for (const change of [
      { passedCases: 3 },
      { completedCases: -1 },
      {
        results: [
          { runId: "foreign", caseId: "x", executionId: "exec", passed: false, assertions: [], coverage: coverage() },
        ],
      },
    ]) {
      const current = fixture(change as Partial<RunSnapshot>);
      expect(() => readQualityAssessment(current.repository, "run_quality")).toThrow();
    }
    const { repository, dir } = fixture();
    writeFileSync(join(dir, "run.json"), '{"runId":');
    expect(() => readQualityAssessment(repository, "run_quality")).toThrow(/verified run/);
    const partial = fixture({}, false);
    expect(() => readQualityAssessment(partial.repository, "run_quality")).toThrow(/verified run/);
  });
  it("fails closed on corrupt records, unsafe directories and competing writer locks", () => {
    const { root, repository } = fixture(),
      initial = readQualityAssessment(repository, "run_quality");
    recordQualityDecision(repository, "run_quality", choice(initial));
    const file = join(
      root,
      ".quality",
      readdirSync(join(root, ".quality")).find((name) => name.endsWith(".json"))!,
    );
    writeFileSync(`${file}.lock`, "interrupted");
    expect(() =>
      recordQualityDecision(repository, "run_quality", choice(readQualityAssessment(repository, "run_quality"))),
    ).toThrow(/writer/);
    expect(readFileSync(`${file}.lock`, "utf8")).toBe("interrupted");
    writeFileSync(file, '{"v":');
    expect(() => readQualityAssessment(repository, "run_quality")).toThrow(/corrupt/);
    expect(readFileSync(file, "utf8")).toBe('{"v":');
    const linked = fixture(),
      target = mkdtempSync(join(tmpdir(), "canary-r29-target-"));
    roots.push(target);
    symlinkSync(target, join(linked.root, ".quality"), "junction");
    expect(() => readQualityAssessment(linked.repository, "run_quality")).toThrow(/ordinary directories/);
    expect(readdirSync(target)).toEqual([]);
  });
  it("rejects foreign stored identity, unknown authority fields, forged options and secret-bearing operator text", () => {
    const { repository } = fixture(),
      initial = readQualityAssessment(repository, "run_quality");
    for (const update of [
      { optionId: "foreign-option" },
      { executionGranted: true },
      { actor: "api_key=private-secret-value" },
    ])
      expect(() => recordQualityDecision(repository, "run_quality", choice(initial, update))).toThrow();
    const forged = structuredClone(initial.report);
    forged.issues[0]!.recommendedOptionId = "missing";
    forged.contentHash = qualityContentHash(forged);
    expect(() => parseQualityAssessment(forged)).toThrow();
    const changed = structuredClone(initial.report);
    changed.binding.runHash = "0".repeat(64);
    expect(() => parseQualityAssessment(changed)).toThrow(/hash/);
  });
  it("bounds many failures without losing total counts and bounds long decision history while retaining the newest choice", () => {
    const baseline = fixture(),
      many = Array.from({ length: 50 }, (_, index) => ({
        ...baseline.run.results[0]!,
        executionId: `exec_${index}`,
        assertions: [{ id: "failed", passed: false, message: "错误证据".repeat(130) }],
      }));
    const current = fixture({ totalCases: 50, completedCases: 50, results: many });
    const initial = readQualityAssessment(current.repository, "run_quality");
    expect(initial.report.counts.issues).toBe(50);
    expect(initial.report.issues.length + initial.report.omittedIssues).toBe(50);
    expect(initial.report.issues.length).toBeGreaterThan(0);
    expect(Buffer.byteLength(JSON.stringify(initial.report))).toBeLessThanOrEqual(49_152);
    const history = fixture();
    let view = readQualityAssessment(history.repository, "run_quality");
    for (let index = 0; index < 18; index++)
      view = recordQualityDecision(
        history.repository,
        "run_quality",
        choice(view, { reason: `Reviewed iteration ${index}` }),
      );
    expect(view.decisions).toHaveLength(16);
    expect(view.omittedDecisions).toBe(2);
    expect(view.decisions.at(-1)!.revision).toBe(18);
    expect(Buffer.byteLength(JSON.stringify(view))).toBeLessThanOrEqual(65_536);
  });
  it("rechecks integrity status as well as manifest hash after report construction", () => {
    const { repository } = fixture(),
      original = repository.verify.bind(repository);
    let calls = 0;
    vi.spyOn(repository, "verify").mockImplementation((runId) => {
      const result = original(runId);
      return ++calls >= 3 ? { ...result, status: "invalid" } : result;
    });
    expect(() => readQualityAssessment(repository, "run_quality")).toThrow(/changed/);
  });
});
