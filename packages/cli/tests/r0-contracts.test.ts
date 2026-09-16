import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import type { RunCommandResult } from "../src/index.js";
import { resolve } from "node:path";
import {
  CLI_EXIT,
  ciExitCodeForRun,
  ciResultSchema,
  evidenceStatusSchema,
  projectContextSchema,
  type RunSnapshot,
} from "@canary/core";
import { classifyCiError, CliFailure, executeCi, parseCiOptions } from "../src/ci.js";
import { invocationRoot, resolveProjectContext } from "../src/home.js";

afterEach(() => vi.unstubAllEnvs());
const context = resolveProjectContext({ cwd: resolve("fixtures") });
function snapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    runId: "test",
    status: "completed",
    totalCases: 1,
    passedCases: 1,
    startedAt: new Date(0).toISOString(),
    results: [],
    ...overrides,
  } as RunSnapshot;
}
describe("R0 frozen contracts", () => {
  it("freezes numeric exits and keeps evidence status independent of run outcome", () => {
    expect(CLI_EXIT).toEqual({
      success: 0,
      checkFailed: 1,
      configuration: 2,
      interrupted: 3,
      environment: 4,
      artifact: 5,
      policy: 6,
      internal: 10,
    });
    for (const status of ["verified", "declared", "blocked", "excluded"])
      expect(evidenceStatusSchema.parse(status)).toBe(status);
    expect(evidenceStatusSchema.safeParse("passed").success).toBe(false);
  });
  it("rejects relative roots and the removed installation fallback in the active schema", () => {
    expect(projectContextSchema.safeParse({ ...context, projectRoot: "relative" }).success).toBe(false);
    expect(projectContextSchema.safeParse({ ...context, source: "install" }).success).toBe(false);
  });
  it("only honors INIT_CWD in the pnpm CLI script, not a global process", () => {
    vi.stubEnv("INIT_CWD", resolve("wrong inherited root"));
    vi.stubEnv("npm_package_name", "");
    expect(invocationRoot()).toBe(process.cwd());
    vi.stubEnv("npm_package_name", "@canary/cli");
    vi.stubEnv("npm_lifecycle_event", "canary");
    expect(invocationRoot()).toBe(resolve("wrong inherited root"));
    expect(invocationRoot(resolve("explicit"))).toBe(resolve("explicit"));
  });
  it("gives policy precedence over interrupted and failed checks", () => {
    expect(ciExitCodeForRun(snapshot(), 0)).toBe(0);
    expect(ciExitCodeForRun(snapshot(), 1)).toBe(1);
    expect(ciExitCodeForRun(snapshot({ status: "cancelled" }), 1)).toBe(3);
    expect(
      ciExitCodeForRun(
        snapshot({ status: "cancelled", gate: { failureCategory: "policy_violation" } as RunSnapshot["gate"] }),
        1,
      ),
    ).toBe(6);
    const timed = { passed: false, failureCategory: "timeout" } as RunSnapshot["results"][number];
    expect(ciExitCodeForRun(snapshot({ results: [timed] }), 1)).toBe(3);
    expect(ciExitCodeForRun(snapshot({ results: [{ ...timed, passed: true }] }), 0)).toBe(0);
  });
  it("classifies filesystem errors only inside artifactRoot", () => {
    expect(
      classifyCiError({ code: "ENOSPC", path: resolve(context.artifactRoot, "run", "run.json") }, context).exitCode,
    ).toBe(5);
    expect(
      classifyCiError({ code: "EACCES", path: resolve(context.artifactRoot, "..", "source.ts") }, context).exitCode,
    ).toBe(10);
    expect(classifyCiError(new Error("api_key=secret"), context).message).not.toContain("secret");
  });
  it.each([2, 3, 4, 5, 6, 10] as const)("serializes failure %s through the real CI envelope", async (exitCode) => {
    const before = process.listenerCount("SIGINT");
    const result = await executeCi(["--ci"], async () => {
      throw new CliFailure(exitCode, "INJECTED", "Fault injection", "Retry the isolated fixture.");
    });
    expect(result.exitCode).toBe(exitCode);
    expect(ciResultSchema.safeParse(result).success).toBe(true);
    expect(ciResultSchema.safeParse({ ...result, outcome: "passed" }).success).toBe(false);
    expect(process.listenerCount("SIGINT")).toBe(before);
  });
  it("CI parser forces headless and never accepts a web port", () => {
    expect(parseCiOptions(["--ci", "--json", "--tag", "one", "--tag", "two"])).toMatchObject({
      ci: true,
      headless: true,
      noOpen: true,
      tags: ["one", "two"],
    });
    expect(() => parseCiOptions(["--ci", "--port", "0"])).toThrow();
  });
});

describe("CI finalization", () => {
  it("catches cleanup failure, preserves the envelope and removes signal handlers", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "canary-r0-finalize-"));
    const context = resolveProjectContext({ cwd: root });
    const runId = "test-finalize";
    const dir = resolve(context.artifactRoot, runId);
    mkdirSync(dir, { recursive: true });
    const before = process.listenerCount("SIGTERM");
    try {
      const result = await executeCi(
        ["--ci", "--config", resolve(root, "canary.config.ts")],
        async () =>
          ({
            runId,
            artifactPath: resolve(dir, "run.json"),
            exitCode: 0,
            snapshot: snapshot(),
            close: async () => {
              throw new Error("api_key=secret");
            },
          }) as RunCommandResult,
      );
      expect(result.exitCode).toBe(10);
      expect(JSON.parse(readFileSync(resolve(dir, "ci.json"), "utf8"))).toEqual(result);
      expect(readdirSync(dir).some((name) => name.endsWith(".tmp"))).toBe(false);
      expect(JSON.stringify(result)).not.toContain("api_key=secret");
      expect(process.listenerCount("SIGTERM")).toBe(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("reports artifact finalization errors instead of returning a false success", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "canary-r0-finalize-error-"));
    try {
      const result = await executeCi(
        ["--ci", "--config", resolve(root, "canary.config.ts")],
        async () =>
          ({
            runId: "missing-run-dir",
            artifactPath: resolve(root, ".canary/artifacts/missing-run-dir/run.json"),
            exitCode: 0,
            snapshot: snapshot(),
            close: async () => {},
          }) as RunCommandResult,
      );
      expect(result.exitCode).toBe(5);
      expect(result.issues[0]?.code).toBe("ARTIFACT_IO");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
