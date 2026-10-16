import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { defineProjectConfig, repairTaskBundleSchema, type ProjectCheckResult, type RunSnapshot } from "@canary/core";
import { sha256, stableHash } from "../src/artifacts.js";
import { createRepairTaskBundle, verifyRepairTaskBundle } from "../src/repair-task.js";

const digest = "a".repeat(64),
  commit = "b".repeat(40),
  projectRoot = resolve("project");
function fixture() {
  const plan = defineProjectConfig({
    kind: "canary.project",
    version: 1,
    checks: [
      { id: "build", type: "command", command: "node", args: ["build.js"] },
      { id: "test", type: "command", command: "node", args: ["test.js"], dependsOn: ["build"] },
      { id: "lint", type: "command", command: "node", args: ["lint.js"] },
    ],
    reproduction: { requiredEnvironment: ["API_TOKEN"], services: ["test-database"], data: ["seed-fixture"] },
  });
  const checks: ProjectCheckResult[] = plan.checks.map((check) => ({
    id: check.id,
    type: check.type,
    version: 1,
    required: check.required,
    status: check.id === "test" ? "failed" : "passed",
    evidence: "verified",
    category: check.id === "test" ? "assertion" : "none",
    retryable: false,
    durationMs: 1,
    exitCode: check.id === "test" ? 1 : 0,
    cwd: ".",
    envAllowlist: [],
    ...(check.type === "command" ? { command: check.command, args: check.args } : {}),
    stderr:
      check.id === "test"
        ? `AssertionError: retained original assertion\n at test (${projectRoot}/src/test.ts:12:3)`
        : "",
  }));
  const run: RunSnapshot = {
    runId: "run_failure",
    status: "failed",
    startedAt: "2026-10-16T00:00:00Z",
    totalCases: 3,
    completedCases: 3,
    passedCases: 2,
    checks,
    results: [],
    events: [],
    evidence: {
      v: 1,
      lineage: {},
      reproduction: {
        configHash: stableHash(plan),
        casesHash: stableHash(plan.checks),
        sourceHash: digest,
        gitCommit: commit,
        gitDirty: false,
        projectPath: ".",
        node: "24.7.0",
        platform: "linux",
        arch: "arm64",
        toolVersions: { git: "git version 2.50.0" },
        lockfiles: { "pnpm-lock.yaml": digest },
        environmentHash: digest,
        environmentNames: ["PATH"],
        mode: "recorded",
      },
    },
  };
  return { plan, run, projectRoot, manifestHash: digest, executionSourceHash: digest, allowedPaths: ["src"] };
}
const bundle = () => createRepairTaskBundle(fixture());

describe("inert repair task handoff", () => {
  it("retains all original declarations, dependency order, historical runtime and bounded source evidence without modifying the run", () => {
    const input = fixture(),
      before = JSON.stringify(input.run);
    const first = createRepairTaskBundle(input),
      second = createRepairTaskBundle(input);
    expect(first).toEqual(second);
    expect(verifyRepairTaskBundle(JSON.parse(JSON.stringify(first)))).toBe(true);
    expect(JSON.stringify(input.run)).toBe(before);
    expect(first.task).toMatchObject({
      selectedChecks: ["test"],
      reproductionChecks: ["build", "test"],
      scope: { status: "declared", allowedPaths: ["src"] },
      runtime: { node: "24.7.0", platform: "linux", arch: "arm64" },
      executionGranted: false,
      blockers: [],
    });
    expect(first.task.originalChecks.map((check) => check.id)).toEqual(["build", "test", "lint"]);
    expect(first.task.originalChecks[2]!.definitionHash).toBe(stableHash(input.plan.checks[2]));
    expect(first.task.failures[0]).toMatchObject({
      checkId: "test",
      locations: [{ path: "src/test.ts", line: 12, column: 3 }],
      rootCause: { status: "unknown" },
    });
    expect(JSON.stringify(first)).not.toContain(projectRoot);
    expect(first.task.commands).toEqual([
      {
        checkId: "test",
        argv: ["canary", "reproduce", "run_failure", "--check", "test"],
        intent: "inspect-reproduction",
        requiresExecutionGrant: false,
      },
      {
        checkId: "test",
        argv: ["canary", "run", "--ci"],
        intent: "rerun-after-authorization",
        requiresExecutionGrant: true,
      },
    ]);
    expect(first.guide).toContain("canary repair-verify");
  });

  it("redacts cross-check opaque secrets and known project/tool paths before excerpts and hashing", () => {
    const input = fixture(),
      secret = "opaque-password-not-pattern-shaped",
      tool = resolve("private-tool", "canary-agent.mjs");
    input.plan.checks[0] = {
      ...input.plan.checks[0]!,
      type: "command",
      command: "node",
      args: ["--password", secret],
      expectedExit: 0,
    };
    input.run.evidence!.reproduction.configHash = stableHash(input.plan);
    input.run.evidence!.reproduction.commandTools = { node: { kind: "canary-script", path: tool, sha256: digest } };
    input.run.checks![0]!.args = ["--password", secret];
    input.run.checks![1]!.stderr += `\nEcho ${secret}, tool ${tool}, key=unclassified\nhttps://username:password@example.test\nC:\\Users\\Alice\\private\\outside.js:2:1\n/home/bob/private/outside.js:2:1`;
    const result = createRepairTaskBundle(input),
      text = JSON.stringify(result);
    expect(text).not.toContain(secret);
    expect(text).not.toContain(tool);
    expect(text).not.toContain(projectRoot);
    expect(text).not.toContain("username:password");
    expect(text).not.toContain("Alice");
    expect(text).not.toContain("/home/bob");
    expect(text).toContain("<canary-tool>");
    expect(verifyRepairTaskBundle(result)).toBe(true);
  });

  it("keeps missing identity and scope as explicit blockers rather than authorizing repair", () => {
    const input = fixture();
    delete input.run.evidence!.reproduction.gitCommit;
    delete input.run.evidence!.reproduction.gitDirty;
    input.executionSourceHash = undefined as never;
    input.allowedPaths = [];
    const result = createRepairTaskBundle(input);
    expect(result.task.blockers).toContain("Repair scope has not been declared.");
    expect(result.task.blockers).toContain("The source run has no recorded Git commit.");
    expect(result.task.blockers).toContain("The source run does not establish a clean Git source state.");
    expect(result.task.blockers).toContain("Execution source observations are not attached.");
    expect(result.task.executionGranted).toBe(false);
    expect(verifyRepairTaskBundle(result)).toBe(true);
  });

  it("refuses mismatched plans, unfinished or successful runs, duplicate or nonfailed selections", () => {
    for (const mutate of [
      (input: ReturnType<typeof fixture>) => {
        input.plan.budgetMs += 1;
      },
      (input: ReturnType<typeof fixture>) => {
        input.run.status = "running";
      },
      (input: ReturnType<typeof fixture>) => {
        input.run.status = "completed";
      },
      (input: ReturnType<typeof fixture>) => {
        Object.assign(input, { checks: ["test", "test"] });
      },
      (input: ReturnType<typeof fixture>) => {
        Object.assign(input, { checks: ["lint"] });
      },
    ]) {
      const input = fixture();
      mutate(input);
      expect(() => createRepairTaskBundle(input)).toThrow();
    }
  });

  it("detects manifest, task, guide, duplicate-entry and partial-write corruption", () => {
    for (const mutate of [
      (value: ReturnType<typeof bundle>) => {
        value.task.failures[0]!.originalError.stderr += "changed";
      },
      (value: ReturnType<typeof bundle>) => {
        value.task.taskId = "task_" + "0".repeat(24);
      },
      (value: ReturnType<typeof bundle>) => {
        value.guide += "changed";
      },
      (value: ReturnType<typeof bundle>) => {
        value.manifest[0]!.bytes += 1;
      },
      (value: ReturnType<typeof bundle>) => {
        value.manifest[1] = value.manifest[0]!;
      },
      (value: ReturnType<typeof bundle>) => {
        value.manifest.pop();
      },
      (value: ReturnType<typeof bundle>) => {
        Object.assign(value, { extra: true });
      },
    ]) {
      const value = bundle();
      mutate(value);
      expect(verifyRepairTaskBundle(value)).toBe(false);
    }
    expect(verifyRepairTaskBundle(null)).toBe(false);
    expect(verifyRepairTaskBundle(JSON.stringify(bundle()).slice(0, -15))).toBe(false);
  });

  it("rejects contradictory schemas, unsafe shell commands, extra fields and unredacted secrets even after manifest rehash", () => {
    for (const mutate of [
      (value: ReturnType<typeof bundle>) => {
        value.task.executionGranted = true as never;
      },
      (value: ReturnType<typeof bundle>) => {
        value.task.scope.allowedPaths = [];
      },
      (value: ReturnType<typeof bundle>) => {
        value.task.failures[0]!.checkId = "lint";
      },
      (value: ReturnType<typeof bundle>) => {
        value.task.reproductionChecks = ["test", "build"];
      },
      (value: ReturnType<typeof bundle>) => {
        value.task.originalChecks.pop();
        value.task.originalChecks.push(value.task.originalChecks[0]!);
      },
      (value: ReturnType<typeof bundle>) => {
        value.task.commands[0]!.argv.push("--execute");
      },
      (value: ReturnType<typeof bundle>) => {
        value.task.commands[1]!.requiresExecutionGrant = false;
      },
      (value: ReturnType<typeof bundle>) => {
        value.task.failures[0]!.originalError.stderr = "password=unsafe-value";
      },
      (value: ReturnType<typeof bundle>) => {
        Object.assign(value.task.source, { command: "rm -rf /" });
      },
    ]) {
      const value = bundle();
      mutate(value);
      const { taskId: _taskId, ...unsigned } = value.task;
      value.task.taskId = `task_${stableHash(unsigned).slice(0, 24)}`;
      value.manifest = [
        {
          path: "task.json",
          bytes: Buffer.byteLength(JSON.stringify(value.task)),
          sha256: sha256(JSON.stringify(value.task)),
        },
        { path: "TASK.md", bytes: Buffer.byteLength(value.guide), sha256: sha256(value.guide) },
      ];
      expect(verifyRepairTaskBundle(value)).toBe(false);
    }
  });

  it("bounds multibyte failure evidence while preserving all declared scope and check identities", () => {
    const input = fixture();
    input.plan = defineProjectConfig({
      kind: "canary.project",
      version: 1,
      checks: Array.from({ length: 16 }, (_, index) => ({ id: `test_${index}`, type: "command", command: "node" })),
    });
    input.run.evidence!.reproduction.configHash = stableHash(input.plan);
    input.run.checks = input.plan.checks.map((check) => ({
      ...input.run.checks![1]!,
      id: check.id,
      stdout: "😱".repeat(4000),
      stderr:
        "界".repeat(4000) +
        Array.from(
          { length: 16 },
          (_, index) => `\n at test (${projectRoot}/src/${"x".repeat(210)}${index}.ts:1:1)`,
        ).join(""),
    }));
    const result = createRepairTaskBundle(input);
    expect(Buffer.byteLength(JSON.stringify(result)) + 1).toBeLessThanOrEqual(65_536);
    expect(result.task.selectedChecks).toHaveLength(16);
    expect(result.task.originalChecks).toHaveLength(16);
    expect(result.task.scope.allowedPaths).toEqual(["src"]);
    expect(result.task.failures.every((item) => item.originalError.truncated)).toBe(true);
    expect(verifyRepairTaskBundle(result)).toBe(true);
  });

  it("rejects essential metadata beyond the byte budget instead of silently omitting original checks", () => {
    const input = fixture();
    input.plan = defineProjectConfig({
      kind: "canary.project",
      version: 1,
      checks: Array.from({ length: 700 }, (_, index) => ({ id: `test_${index}`, type: "command", command: "node" })),
    });
    input.run.evidence!.reproduction.configHash = stableHash(input.plan);
    input.run.checks![1]!.id = "test_0";
    expect(() => createRepairTaskBundle(input)).toThrow(/byte budget/);
  });

  it("retains dependency blocking as a hypothesis and never upgrades it to a confirmed root cause", () => {
    const input = fixture();
    input.run.checks![0]!.status = "failed";
    input.run.checks![0]!.category = "assertion";
    input.run.checks![1]!.status = "blocked";
    input.run.checks![1]!.category = "dependency";
    input.run.checks![1]!.dependsOn = ["build"];
    const result = createRepairTaskBundle(input);
    expect(result.task.failures[1]!.rootCause.status).toBe("hypothesis");
    expect(repairTaskBundleSchema.safeParse(result).success).toBe(true);
  });

  it("verifies task identity across locale-dependent key ordering, including non-ASCII lockfile names", () => {
    const input = fixture();
    input.run.evidence!.reproduction.lockfiles = {
      "中文/lock.json": digest,
      "ä/lock.json": digest,
      "z/lock.json": digest,
    };
    const result = createRepairTaskBundle(input);
    const original = String.prototype.localeCompare;
    const locale = vi.spyOn(String.prototype, "localeCompare").mockImplementation(function (
      this: string,
      other: string,
    ) {
      return -original.call(this, other);
    });
    try {
      expect(verifyRepairTaskBundle(JSON.parse(JSON.stringify(result)))).toBe(true);
    } finally {
      locale.mockRestore();
    }
  });
});
