import { afterEach, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beginArtifacts, sealArtifacts, writePrivateJson, FileArtifactRepository } from "@canary/trace";
import { assessmentCommand } from "../src/assessment.js";
const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    if (resolve(root).startsWith(resolve(tmpdir(), "canary-r29-cli-"))) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "canary-r29-cli-"));
  roots.push(root);
  writeFileSync(join(root, "package.json"), '{"name":"quality-command","private":true}');
  writeFileSync(join(root, "canary.project.json"), JSON.stringify({ kind: "canary.project", checks: [] }));
  const artifacts = join(root, ".canary", "artifacts"),
    dir = join(artifacts, "run_quality");
  mkdirSync(artifacts, { recursive: true });
  beginArtifacts(dir);
  const metric = { covered: 0, total: 0, pct: 0 },
    coverage = {
      runId: "run_quality",
      sourceHash: "1".repeat(16),
      status: "final",
      lines: metric,
      statements: metric,
      functions: metric,
      branches: metric,
      files: [],
      featureChains: [],
    };
  writePrivateJson(join(dir, "run.json"), {
    runId: "run_quality",
    status: "failed",
    startedAt: "2026-10-17T00:00:00Z",
    totalCases: 1,
    completedCases: 1,
    passedCases: 0,
    results: [
      {
        runId: "run_quality",
        executionId: "exec_quality",
        caseId: "routing",
        passed: false,
        assertions: [{ id: "tool.called", passed: false, message: "Expected lookup" }],
        coverage,
      },
    ],
    events: [],
  });
  sealArtifacts(dir);
  return { root, artifacts, repository: new FileArtifactRepository(artifacts) };
}
function output(args: string[]) {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined),
    error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const code = assessmentCommand([...args, "--json"]);
  const value = JSON.parse(log.mock.calls.at(-1)![0]);
  log.mockRestore();
  error.mockRestore();
  return { code, value };
}
it("reads an explicitly selected project without executing config, Agent or checks, then records a direction", () => {
  const { root, artifacts, repository } = fixture(),
    integrity = repository.verify("run_quality");
  const initial = output(["run_quality", "--project", root]);
  expect(initial.code).toBe(0);
  expect(initial.value.report.counts.agent.failed).toBe(1);
  expect(existsSync(join(artifacts, ".quality"))).toBe(false);
  const saved = output([
    "decide",
    "run_quality",
    "--project",
    root,
    "--report-hash",
    initial.value.report.contentHash,
    "--expected-revision",
    "0",
    "--option",
    initial.value.report.options[0].id,
    "--action",
    "select",
    "--actor",
    "qa-maintainer",
    "--reason",
    "Confirm the required behavior",
  ]);
  expect(saved.code).toBe(0);
  expect(saved.value.decisions[0]).toMatchObject({
    actor: "qa-maintainer",
    verificationStatus: "not-executed",
    executionGranted: false,
  });
  expect(repository.verify("run_quality")).toEqual(integrity);
});
it("rejects unknown flags, secret-bearing reasons and stale selections with machine-readable errors", () => {
  const { root, artifacts } = fixture(),
    initial = output(["run_quality", "--project", root]);
  expect(output(["run_quality", "--project", root, "--execute"]).value.code).toBe("QUALITY_INPUT");
  const args = [
    "decide",
    "run_quality",
    "--project",
    root,
    "--report-hash",
    initial.value.report.contentHash,
    "--expected-revision",
    "0",
    "--option",
    initial.value.report.options[0].id,
    "--action",
    "select",
    "--actor",
    "maintainer",
    "--reason",
  ];
  expect(output([...args, "api_key=secret-operator-value"]).code).toBe(2);
  expect(existsSync(join(artifacts, ".quality"))).toBe(false);
  expect(output([...args, "Inspect the evidence"]).code).toBe(0);
  const file = join(artifacts, ".quality", readdirSync(join(artifacts, ".quality"))[0]!),
    before = readFileSync(file);
  const stale = output([...args, "Inspect the evidence"]);
  expect(stale.code).toBe(1);
  expect(stale.value.code).toBe("QUALITY_STALE");
  expect(readFileSync(file)).toEqual(before);
});
