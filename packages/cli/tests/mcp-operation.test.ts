import { it, expect, vi } from "vitest";
import { executeMcpVerification } from "../src/mcp-operations.js";
import { resolveProjectContext } from "../src/home.js";
import { runCheckProcess } from "../src/check-executor.js";

vi.mock("../src/check-executor.js", () => ({ runCheckProcess: vi.fn() }));
const hash = "a".repeat(64), commit = "b".repeat(40);
const proof = { commit, indexHash: hash, trackedStatusHash: hash, sourceHash: hash, trackedFilesHash: hash };
const receipt = { v: 1, kind: "canary.repair-verification", outcome: "verified", original: { runId: "run_original", commit, manifestHash: hash }, candidate: { runId: "run_candidate", commit: "c".repeat(40), manifestHash: hash }, executed: true, reasons: [], regressionChecks: ["regression"], testFiles: ["regression.test.mjs"], beforeRegression: { runId: "run_regression", commit, manifestHash: hash, sourceUnchanged: true, executionSource: proof, observedSource: proof, testOverlay: [{ path: "regression.test.mjs", hash }] } };
const fullReceipt = { ...receipt, executionSources: {
  original: { v: 1, kind: "canary.execution-source", runId: "run_original", status: "unchanged", before: proof, after: proof },
  candidate: { v: 1, kind: "canary.execution-source", runId: "run_candidate", status: "unchanged", before: { ...proof, commit: "c".repeat(40) }, after: { ...proof, commit: "c".repeat(40) } },
} };
const input = { operation: "repair-verify" as const, runId: "run_original", candidateRunId: "run_candidate", regression: ["regression"], tests: ["regression.test.mjs"], action: "execute" as const };

it.each([0, 1, 3])("requires a clean process exit before returning a successful receipt (exit %i)", async code => {
  vi.mocked(runCheckProcess).mockImplementation(async (_command, _args, _cwd, _env, _signal, _pid, _ready, stdout) => {
    stdout!(JSON.stringify(fullReceipt));
    return { status: code ? "failed" : "passed", category: code ? "assertion" : "none", exitCode: code, processExit: code };
  });
  const result = await executeMcpVerification(input, resolveProjectContext(), new AbortController().signal);
  expect(result.outcome).toBe(code === 0 ? "verified" : "evidence-insufficient");
});

it("does not return a successful receipt emitted just before cancellation", async () => {
  const controller = new AbortController();
  vi.mocked(runCheckProcess).mockImplementation(async (_command, _args, _cwd, _env, _signal, _pid, _ready, stdout) => {
    stdout!(JSON.stringify(fullReceipt)); controller.abort();
    return { status: "passed", category: "none", exitCode: 0, processExit: 0 };
  });
  expect(await executeMcpVerification(input, resolveProjectContext(), controller.signal)).toMatchObject({ outcome: "cancelled", exitCode: 3 });
});

it("enforces the machine-output budget in UTF-8 bytes", async () => {
  vi.mocked(runCheckProcess).mockImplementation(async (_command, _args, _cwd, _env, _signal, _pid, _ready, stdout) => {
    stdout!(JSON.stringify({ ...receipt, notes: "中".repeat(30_000) }));
    return { status: "passed", category: "none", exitCode: 0, processExit: 0 };
  });
  expect(await executeMcpVerification(input, resolveProjectContext(), new AbortController().signal)).toMatchObject({ outcome: "evidence-insufficient", exitCode: 5 });
});
