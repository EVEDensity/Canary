import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { CanaryMcpServer, LEGACY_PROTOCOL_VERSION, serveStdio } from "@canary/mcp-server";
import type { QualityAssessmentView, RunSnapshot } from "@canary/core";
import {
  FileArtifactRepository,
  beginArtifacts,
  sealArtifacts,
  writePrivateJson,
  readQualityAssessment,
  readImprovementHistory,
} from "@canary/trace";
import { resolveProjectContext } from "../src/home.js";
import { bindPorts, mcpCommand } from "../src/mcp.js";

vi.mock("@canary/mcp-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@canary/mcp-server")>()),
  serveStdio: vi.fn(async () => undefined),
}));
const roots: string[] = [];
afterEach(() => {
  vi.mocked(serveStdio).mockClear();
  const parent = realpathSync.native(tmpdir());
  for (const root of roots.splice(0)) {
    const part = relative(parent, root);
    if (!isAbsolute(root) || isAbsolute(part) || part === ".." || part.startsWith("../") || part.startsWith("..\\"))
      throw new Error("Unsafe assessment fixture cleanup");
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
});
function directory() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "canary MCP quality ")));
  roots.push(root);
  writeFileSync(join(root, "package.json"), '{"name":"assessment-fixture","private":true}');
  mkdirSync(join(root, ".canary", "artifacts"), { recursive: true });
  writeFileSync(join(root, "agent.mjs"), "export const agent = () => 'retained fixture';\n");
  return root;
}
function hashes(root: string): Record<string, string> {
  const output: Record<string, string> = {};
  const visit = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile())
        output[relative(root, file).replaceAll("\\", "/")] = createHash("sha256")
          .update(readFileSync(file))
          .digest("hex");
      else throw new Error("Unexpected assessment fixture entry");
    }
  };
  visit(root);
  return output;
}
function sealAgent(root: string) {
  const context = resolveProjectContext({ cwd: root }),
    repository = new FileArtifactRepository(context.artifactRoot),
    runId = "run_agent_quality";
  const metric = { covered: 0, total: 0, pct: 0 };
  const run: RunSnapshot = {
    runId,
    status: "failed",
    startedAt: "2026-10-17T00:00:00Z",
    finishedAt: "2026-10-17T00:00:01Z",
    totalCases: 1,
    completedCases: 1,
    passedCases: 0,
    events: [],
    results: [
      {
        runId,
        executionId: "execution_tool",
        caseId: "lookup-route",
        passed: false,
        assertions: [
          { id: "tool.called.lookup", passed: false, message: "Expected lookup; the retained execution called echo" },
        ],
        coverage: {
          runId,
          sourceHash: "a".repeat(64),
          status: "unavailable",
          lines: metric,
          statements: metric,
          functions: metric,
          branches: metric,
          featureChains: [],
        },
        metrics: { latencyMs: 12, steps: 1, toolCalls: 1 },
      },
    ],
  };
  const dir = join(repository.rootDir, runId);
  beginArtifacts(dir);
  writePrivateJson(join(dir, "run.json"), run);
  sealArtifacts(dir);
  return { context, repository, runId };
}
async function boundServer(root: string, enabled = false) {
  const context = resolveProjectContext({ cwd: root });
  const bindings = {
    allowAssessmentDecisions: enabled,
    readRun: vi.fn(() => {
      throw new Error("Assessment must read sealed bytes directly");
    }),
    runHeadless: vi.fn(async () => {
      throw new Error("Assessment must not execute checks");
    }),
    verify: vi.fn(async () => {
      throw new Error("Assessment must not execute verification");
    }),
  };
  const ports = bindPorts(context, bindings),
    server = new CanaryMcpServer({ token: "fixture", ports });
  await server.handleRequestAsync({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: LEGACY_PROTOCOL_VERSION },
  });
  server.handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" });
  let id = 1;
  return {
    context,
    ports,
    server,
    bindings,
    call: (name: string, args: object) =>
      server.handleRequestAsync({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }),
  };
}
const view = (response: Awaited<ReturnType<CanaryMcpServer["handleRequestAsync"]>>) =>
  (response?.result as { structuredContent: QualityAssessmentView }).structuredContent;

it("reads sealed Agent quality without writing state, and binds all reads to the selected project", async () => {
  const root = directory(),
    foreignRoot = directory(),
    fixture = sealAgent(root),
    bound = await boundServer(root),
    foreign = await boundServer(foreignRoot),
    before = hashes(root),
    foreignBefore = hashes(foreignRoot);
  const response = await bound.call("canary.assessment", { runId: fixture.runId });
  const history = await bound.call("canary.improvements", { runId: fixture.runId });
  expect(history?.error).toBeUndefined();
  expect((history?.result as { structuredContent: unknown }).structuredContent).toEqual(
    readImprovementHistory(fixture.repository, fixture.runId),
  );
  expect((await foreign.call("canary.improvements", { runId: fixture.runId }))?.error).toBeDefined();
  expect((await bound.call("canary.improvements", { runId: fixture.runId, execute: true }))?.error?.code).toBe(-32602);
  expect(response?.error, JSON.stringify(response)).toBeUndefined();
  const report = view(response);
  expect(report).toEqual(readQualityAssessment(fixture.repository, fixture.runId));
  expect(report).toMatchObject({
    revision: 0,
    decisions: [],
    executionGranted: false,
    report: { scope: "agent", counts: { agent: { total: 1, failed: 1 } }, advisoryOnly: true },
  });
  expect(report.report.issues[0]!.evidence[0]).toMatchObject({
    caseId: "lookup-route",
    executionId: "execution_tool",
    assertionId: "tool.called.lookup",
  });
  expect(
    report.report.options.find((option) => option.id === report.report.issues[0]!.recommendedOptionId)?.benefitStatus,
  ).toBe("hypothesis");
  expect(existsSync(join(fixture.repository.rootDir, ".quality"))).toBe(false);
  expect(hashes(root)).toEqual(before);
  expect((await foreign.call("canary.assessment", { runId: fixture.runId }))?.error).toBeDefined();
  expect(
    (await bound.call("canary.assessment", { runId: fixture.runId, projectRoot: foreignRoot }))?.error,
  ).toBeDefined();
  expect(
    (await bound.call("canary.assessment_decide", { runId: fixture.runId, allowAssessmentDecisions: true }))?.error
      ?.message,
  ).toMatch(/disabled/);
  expect(hashes(root)).toEqual(before);
  expect(hashes(foreignRoot)).toEqual(foreignBefore);
  expect(bound.bindings.readRun).not.toHaveBeenCalled();
  expect(bound.bindings.runHeadless).not.toHaveBeenCalled();
  expect(bound.bindings.verify).not.toHaveBeenCalled();
});

it("records explicit choices separately from sealed evidence, rejects stale writes and marks prior choices stale after evidence changes", async () => {
  const root = directory(),
    fixture = sealAgent(root),
    bound = await boundServer(root, true),
    sourceBefore = readFileSync(join(root, "agent.mjs")),
    manifest = fixture.repository.verify(fixture.runId).manifestHash;
  const before = view(await bound.call("canary.assessment", { runId: fixture.runId }));
  const choice = {
    runId: fixture.runId,
    reportHash: before.report.contentHash,
    expectedRevision: before.revision,
    optionId: before.report.issues[0]!.recommendedOptionId,
    action: "select",
    actor: "fixture-maintainer",
    reason: "Preserve the original assertion and inspect the candidate",
  };
  const response = await bound.call("canary.assessment_decide", choice);
  expect(response?.error, JSON.stringify(response)).toBeUndefined();
  const selected = view(response);
  expect(selected).toMatchObject({
    revision: 1,
    executionGranted: false,
    selections: [{ issueId: before.report.issues[0]!.id, optionId: choice.optionId, revision: 1 }],
    decisions: [
      {
        optionId: choice.optionId,
        action: "select",
        actor: "fixture-maintainer",
        stale: false,
        executionGranted: false,
        verificationStatus: "not-executed",
      },
    ],
  });
  expect(fixture.repository.verify(fixture.runId)).toMatchObject({ status: "verified", manifestHash: manifest });
  expect(readFileSync(join(root, "agent.mjs"))).toEqual(sourceBefore);
  const recordedFiles = hashes(root);
  const stale = await bound.call("canary.assessment_decide", choice);
  expect(stale?.error?.data).toMatchObject({ qualityCode: "QUALITY_STALE" });
  expect(hashes(root)).toEqual(recordedFiles);
  for (const invalid of [
    { ...choice, expectedRevision: 1, reportHash: "f".repeat(64) },
    { ...choice, expectedRevision: 1, optionId: "unknown-option" },
    { ...choice, expectedRevision: 1, executionGranted: true },
  ])
    expect((await bound.call("canary.assessment_decide", invalid))?.error).toBeDefined();
  expect(hashes(root)).toEqual(recordedFiles);
  fixture.repository.writeJson(fixture.runId, "retained-note.json", {
    reason: "Additional retained artifact changes the manifest binding",
  });
  const refreshed = view(await bound.call("canary.assessment", { runId: fixture.runId }));
  expect(refreshed.report.contentHash).not.toBe(before.report.contentHash);
  expect(refreshed.decisions[0]!.stale).toBe(true);
  const rejected = await bound.call("canary.assessment_decide", {
    ...choice,
    reportHash: refreshed.report.contentHash,
    expectedRevision: refreshed.revision,
    action: "reject",
    reason: "Review the contract before choosing a repair",
  });
  expect(rejected?.error, JSON.stringify(rejected)).toBeUndefined();
  expect(view(rejected).decisions.at(-1)).toMatchObject({
    action: "reject",
    revision: 2,
    stale: false,
    verificationStatus: "not-executed",
  });
  expect(bound.bindings.runHeadless).not.toHaveBeenCalled();
  expect(bound.bindings.verify).not.toHaveBeenCalled();
});

it("enables decision recording only through the explicit server startup flag", async () => {
  const root = directory(),
    configPath = join(root, "canary.project.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      kind: "canary.project",
      version: 1,
      checks: [{ id: "check", type: "command", command: "node", args: ["--version"] }],
    }),
  );
  const bindings = { readRun: () => undefined, runHeadless: async () => undefined, allowAssessmentDecisions: true };
  expect(await mcpCommand(["serve", "--token", "fixture"], configPath, bindings)).toBe(0);
  const disabled = vi.mocked(serveStdio).mock.calls.at(-1)![0];
  expect(disabled.ports.assessmentDecide).toBeUndefined();
  expect(
    await mcpCommand(["serve", "--token", "fixture", "--allow-assessment-decisions"], configPath, {
      ...bindings,
      allowAssessmentDecisions: false,
    }),
  ).toBe(0);
  const enabled = vi.mocked(serveStdio).mock.calls.at(-1)![0];
  expect(enabled.ports.assessmentDecide).toBeTypeOf("function");
  expect(enabled.ports.projectRoot).toBe(resolveProjectContext({ configPath }).projectRoot);
});
