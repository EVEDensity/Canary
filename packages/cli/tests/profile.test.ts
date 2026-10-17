import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { projectChecksConfigSchema } from "@canary/core";
import { beginArtifacts, sealArtifacts, stableHash, writePrivateJson } from "@canary/trace";
import { projectSourceInventory } from "../src/discovery.js";
import { recordEvidence } from "../src/evidence.js";
import { resolveProjectContext } from "../src/home.js";
import { PROFILE_LIMITS, profileCommand, profileProject } from "../src/profile.js";
import { executionSourceProof, sourceFingerprint } from "../src/source-identity.js";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    const path = relative(resolve(tmpdir()), resolve(root));
    if (!path || path.startsWith("..") || isAbsolute(path)) throw new Error("Unsafe profile fixture cleanup");
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
});
function fixture(withRun = true) {
  const root = mkdtempSync(join(tmpdir(), "canary-r31-profile-"));
  roots.push(root);
  writeFileSync(
    join(root, "package.json"),
    '{"name":"profile-fixture","private":true,"scripts":{"test":"must-not-execute"}}',
  );
  writeFileSync(join(root, "source.ts"), "export function greet() { return 'hello'; }\n");
  writeFileSync(
    join(root, "canary.config.ts"),
    [
      "import {writeFileSync} from 'node:fs';",
      "writeFileSync(new URL('./CONFIG_EXECUTED', import.meta.url), 'unexpected');",
      "throw new Error('Project config must not execute while profiling');",
    ].join("\n"),
  );
  const context = resolveProjectContext({ cwd: root });
  if (withRun) {
    const dir = join(context.artifactRoot, "run_profile");
    const metric = { covered: 0, total: 0, pct: 0 },
      coverage = {
        runId: "run_profile",
        sourceHash: "1".repeat(16),
        status: "final",
        lines: metric,
        statements: metric,
        functions: metric,
        branches: metric,
        files: [],
        featureChains: [],
      };
    beginArtifacts(dir);
    writePrivateJson(join(dir, "run.json"), {
      runId: "run_profile",
      status: "failed",
      startedAt: "2026-10-18T00:00:00Z",
      totalCases: 1,
      completedCases: 1,
      passedCases: 0,
      results: [
        {
          runId: "run_profile",
          executionId: "exec_profile",
          caseId: "route",
          passed: false,
          assertions: [{ id: "tool.called", passed: false, message: "Expected lookup" }],
          coverage,
        },
      ],
      events: [],
    });
    sealArtifacts(dir);
  }
  return { root, context };
}
function tree(root: string) {
  const result: Array<{ path: string; hash: string; modified: number }> = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else
        result.push({
          path: relative(root, file),
          hash: createHash("sha256").update(readFileSync(file)).digest("hex"),
          modified: lstatSync(file).mtimeMs,
        });
    }
  };
  walk(root);
  return result;
}
function output(args: string[]) {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined),
    error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const code = profileCommand([...args, "--json"]);
  const value = JSON.parse(log.mock.calls.at(-1)![0]);
  log.mockRestore();
  error.mockRestore();
  return { code, value };
}

it("measures actual analysis with monotonic samples while keeping source, Git index and retained evidence unchanged", () => {
  const { root, context } = fixture();
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, windowsHide: true, stdio: "ignore" });
  git("init", "-q");
  git("-c", "core.autocrlf=false", "add", "package.json", "source.ts", "canary.config.ts");
  // A project-defined Git fsmonitor must not be executed by analysis.
  git("config", "core.fsmonitor", "./must-not-execute");
  const before = tree(root),
    oldLocks = process.env.GIT_OPTIONAL_LOCKS;
  const report = profileProject(context, "run_profile", 3);
  expect(report).toMatchObject({
    kind: "canary.profile",
    requestedSamples: 3,
    readOnly: true,
    executionGranted: false,
  });
  expect(report.stages.map((stage) => stage.id)).toEqual([
    "discovery",
    "structure-build",
    "evidence-verify",
    "quality-brief",
    "project-memory",
  ]);
  for (const stage of report.stages.slice(0, 4)) {
    expect(stage.status, JSON.stringify(report.stages)).toBe("measured");
    expect(stage.timingMs.samples).toHaveLength(3);
    expect(stage.timingMs.samples.every((sample) => Number.isFinite(sample) && sample >= 0)).toBe(true);
    expect(stage.timingMs.min!).toBeLessThanOrEqual(stage.timingMs.median!);
    expect(stage.timingMs.median!).toBeLessThanOrEqual(stage.timingMs.max!);
    expect(stage.bytes).toBeGreaterThan(0);
  }
  expect(report.stages[3]!.counts!.issues).toBe(1);
  expect(report.stages[4]).toMatchObject({ status: "unavailable", code: "PROFILE_MEMORY_MISSING" });
  expect(existsSync(join(root, "CONFIG_EXECUTED"))).toBe(false);
  expect(existsSync(join(root, ".canary", "memory"))).toBe(false);
  expect(existsSync(join(root, ".canary", "experiences"))).toBe(false);
  expect(process.env.GIT_OPTIONAL_LOCKS).toBe(oldLocks);
  expect(tree(root)).toEqual(before);
});

it("reports missing evidence and memory without creating .canary or importing the supplied config", () => {
  const { root } = fixture(false),
    before = tree(root);
  const result = output(["run_missing", "--project", root, "--config", "canary.config.ts", "--samples", "2"]);
  expect(result.code).toBe(0);
  expect(result.value.stages.find((stage: { id: string }) => stage.id === "evidence-verify")).toMatchObject({
    status: "unavailable",
    code: "PROFILE_EVIDENCE_MISSING",
  });
  expect(result.value.stages.find((stage: { id: string }) => stage.id === "quality-brief")).toMatchObject({
    status: "unavailable",
    code: "PROFILE_QUALITY_EVIDENCE_REQUIRED",
  });
  expect(tree(root)).toEqual(before);
  expect(existsSync(join(root, ".canary"))).toBe(false);
});

it("profiles the real inert memory query for a version-bound failed project check, including an empty result", () => {
  const { root, context } = fixture(false),
    runId = "run_project_profile";
  const plan = projectChecksConfigSchema.parse({
    kind: "canary.project",
    version: 1,
    checks: [{ id: "fixture", type: "command", command: "must-not-execute" }],
  });
  writeFileSync(join(root, "canary.project.json"), JSON.stringify(plan));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, windowsHide: true, stdio: "ignore" });
  git("init", "-q");
  git("-c", "core.autocrlf=false", "add", ".");
  git("-c", "user.name=Canary fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "Profile input");
  const inventory = projectSourceInventory(root),
    evidence = recordEvidence(plan, context, [], {}, stableHash(inventory));
  const fingerprint = sourceFingerprint(root),
    proof = executionSourceProof({ runId, evidence }, fingerprint, fingerprint);
  const dir = join(context.artifactRoot, runId);
  beginArtifacts(dir);
  writePrivateJson(join(dir, "run.json"), {
    runId,
    status: "failed",
    startedAt: "2026-10-18T00:00:00Z",
    totalCases: 1,
    completedCases: 1,
    passedCases: 0,
    results: [],
    events: [],
    evidence,
    checks: [
      {
        id: "fixture",
        type: "command",
        version: 1,
        required: true,
        status: "failed",
        evidence: "verified",
        exitCode: 1,
        category: "assertion",
        retryable: false,
        durationMs: 1,
        cwd: root,
        envAllowlist: [],
        processExit: 1,
      },
    ],
  });
  writePrivateJson(join(dir, "check-plan.json"), plan);
  writePrivateJson(join(dir, "source-inventory.json"), inventory);
  writePrivateJson(join(dir, "execution-source.json"), proof);
  sealArtifacts(dir);
  mkdirSync(join(root, ".canary", "memory"));
  const before = tree(root),
    report = profileProject(context, runId, 2);
  expect(report.stages.at(-1), JSON.stringify(report.stages)).toMatchObject({
    status: "measured",
    code: "PROFILE_MEMORY_MEASURED",
    counts: { records: 0, matched: 0 },
  });
  expect(report.stages.at(-1)!.timingMs.samples).toHaveLength(2);
  expect(tree(root)).toEqual(before);
  expect(existsSync(join(root, ".canary", "memory", "records"))).toBe(false);
});

it("retains corrupt evidence and pending memory bytes, reporting actionable unavailable stages", () => {
  const { root, context } = fixture(),
    memory = join(root, ".canary", "memory");
  mkdirSync(memory);
  writeFileSync(join(memory, "transaction.json"), '{"interrupted":true}');
  const before = tree(root),
    initial = profileProject(context, "run_profile");
  expect(initial.stages.at(-1)).toMatchObject({ status: "unavailable", code: "PROFILE_MEMORY_QUERY_UNAVAILABLE" });
  expect(tree(root)).toEqual(before);
  writeFileSync(join(context.artifactRoot, "run_profile", "run.json"), "{broken");
  const broken = tree(root),
    result = profileProject(context, "run_profile");
  expect(result.stages[2]).toMatchObject({ status: "blocked", code: "PROFILE_EVIDENCE_UNVERIFIED" });
  expect(result.stages[3]).toMatchObject({ status: "unavailable", code: "PROFILE_QUALITY_EVIDENCE_REQUIRED" });
  expect(tree(root)).toEqual(broken);
});

it("blocks source input beyond the declared read budget and rejects execution/unknown/invalid flags", () => {
  const { root, context } = fixture(false);
  writeFileSync(join(root, "large.ts"), "");
  truncateSync(join(root, "large.ts"), PROFILE_LIMITS.fileBytes + 1);
  const result = profileProject(context, "run_profile");
  expect(result.stages[0]).toMatchObject({ status: "blocked", code: "PROFILE_INPUT_BUDGET" });
  expect(result.stages[1]).toMatchObject({ status: "blocked", code: "PROFILE_SOURCE_UNAVAILABLE" });
  for (const args of [
    ["run_profile", "--samples", "0"],
    ["run_profile", "--samples", "6"],
    ["run_profile", "--samples", "1.5"],
    ["run_profile", "--execute"],
    ["run_profile", "--samples", "1", "--samples", "2"],
    ["../escape"],
  ]) {
    expect(output(args)).toMatchObject({ code: 2, value: { code: "PROFILE_INPUT", executionGranted: false } });
  }
  expect(existsSync(join(root, ".canary"))).toBe(false);
});
