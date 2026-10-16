import { it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CanaryMcpServer, LEGACY_PROTOCOL_VERSION, parseOperationArgs } from "@canary/mcp-server";
import { FileArtifactRepository, beginArtifacts, writePrivateJson, sealArtifacts } from "@canary/trace";
import { resolveProjectContext } from "../src/home.js";
import { bindPorts, boundConfig, boundedReceipt } from "../src/mcp.js";
import { runCommandDetailed } from "../src/index.js";
import { hostRunOutput, hostEvidenceOutput } from "../src/host.js";
import type { RunSnapshot } from "@canary/core";
import { executeMcpVerification } from "../src/mcp-operations.js";

it("runs a configuration-free project through MCP and returns sealed failures, proposals and missing verification honestly", async () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "canary MCP project ")));
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "mcp-project-fixture", private: true, scripts: { lint: "node healthy.mjs", test: "node failed.mjs" } }));
    writeFileSync(join(root, "healthy.mjs"), "console.log('check passed');\n");
    writeFileSync(join(root, "failed.mjs"), "throw new Error('retained project failure');\n");
    const context = resolveProjectContext({ cwd: root }), repository = new FileArtifactRepository(context.artifactRoot);
    expect(boundConfig(context)).toBeUndefined();
    const server = new CanaryMcpServer({ token: "fixture", ports: bindPorts(context, {
      readRun: id => repository.readRun(id),
      async runHeadless({ context, caseId, signal }) {
        const result = await runCommandDetailed({ cwd: context.projectRoot, configPath: boundConfig(context), caseId, ci: true, signal });
        try { return hostRunOutput(context, result.snapshot, result.artifactPath, result.exitCode); } finally { await result.close(); }
      },
      verify: executeMcpVerification,
    }) });
    await server.handleRequestAsync({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: LEGACY_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "project-fixture", version: "1" } } });
    await server.handleRequestAsync({ jsonrpc: "2.0", method: "notifications/initialized" });
    let id = 1;
    const call = async (name: string, args: object) => {
      const response = await server.handleRequestAsync({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } });
      expect(response?.error, JSON.stringify(response)).toBeUndefined();
      return (response!.result as { structuredContent: any }).structuredContent;
    };
    const run = await call("canary.run", {});
    expect(run.exitCode).toBe(1);
    expect(run.run.totalCases).toBe(2);
    const evidence = await call("canary.evidence", { runId: run.run.runId, maxChecks: 1 });
    expect(evidence.checks).toHaveLength(1);
    expect(evidence.checkPage).toMatchObject({ total: 2, nextOffset: 1 });
    const second = await call("canary.evidence", { runId: run.run.runId, maxChecks: 1, checkOffset: 1 });
    const failed = [...evidence.checks, ...second.checks].find((row: { status: string }) => row.status === "failed");
    expect(failed.diagnosticExcerpt).toContain("retained project failure");
    const diagnostics = await call("canary.diagnostics", { runId: run.run.runId });
    expect(diagnostics.failures.some((failure: { checkId: string }) => failure.checkId === failed.reference.checkId)).toBe(true);
    const proposal = { v: 1, kind: "canary.host.proposal", runId: run.run.runId, caseRefs: [failed.reference.checkId], summary: "Review the retained check failure", observations: [{ caseId: failed.reference.checkId, claim: "Check failed in retained execution" }], suggestedActions: ["Inspect the corresponding source"], limitations: ["Unapproved advisory"] };
    const recorded = await call("canary.submit_proposal", { proposal });
    expect(recorded).toMatchObject({ valid: true, status: "recorded_unapproved", approval: { status: "not_approved" } });
    expect(existsSync(recorded.artifactPath)).toBe(true);
    const bytes = readFileSync(recorded.artifactPath, "utf8");
    expect((await call("canary.submit_proposal", { proposal })).artifactPath).toBe(recorded.artifactPath);
    expect(readFileSync(recorded.artifactPath, "utf8")).toBe(bytes);
    expect(repository.verify(run.run.runId).status).toBe("verified");
    expect(await call("canary.verification", { runId: run.run.runId, kind: "repair" })).toMatchObject({ outcome: "unavailable" });
    repository.writeJson(run.run.runId, "change-verification.json", { v: 999, kind: "canary.change-verification", runId: run.run.runId });
    expect(await call("canary.verification", { runId: run.run.runId, kind: "change" })).toMatchObject({ outcome: "unavailable" });
    const reproduced = await call("canary.reproduce", { runId: run.run.runId, checkId: failed.reference.checkId });
    expect(reproduced.exitCode).not.toBe(0);
    expect(reproduced.outcome).not.toBe("reproduced");
    expect(existsSync(join(root, "canary.project.json"))).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true, maxRetries: 3 }); }
}, 60000);

it("rejects argument-based project/credential escalation and installs an official Skill from a project subdirectory", () => {
  expect(() => parseOperationArgs("canary.reproduce", { runId: "run_test", checkId: "test", project: "/another" })).toThrow();
  expect(() => parseOperationArgs("canary.repair_verify", { runId: "run_test", candidateRunId: "run_after", regression: ["test"], tests: ["../escape.test.mjs"] })).toThrow();
  expect(() => parseOperationArgs("canary.change_verify", { runId: "run_test", base: "--output=/file" })).toThrow();
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "canary Skill CLI ")));
  try {
    writeFileSync(join(root, "package.json"), '{"name":"skill-cli-fixture","private":true}');
    const nested = join(root, "nested"); mkdirSync(nested);
    const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
    for (const help of [[], ["help"], ["--help"], ["-h"]]) {
      expect(spawnSync(process.execPath, [cli, "skill", ...help], { cwd: nested, encoding: "utf8" }).status).toBe(0);
    }
    const result = spawnSync(process.execPath, [cli, "skill", "install"], { cwd: nested, encoding: "utf8", timeout: 30000 });
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(join(root, ".agents/skills/canary-verify/SKILL.md"))).toBe(true);
    expect(existsSync(join(nested, ".agents"))).toBe(false);
    expect(spawnSync(process.execPath, [cli, "skill", "remove"], { cwd: nested, encoding: "utf8" }).status).toBe(0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("redacts command secrets across host excerpts and keeps human review visible in bounded receipts", () => {
  const snapshot: RunSnapshot = { runId: "run_example", status: "failed", startedAt: "2026-10-01T00:00:00Z", totalCases: 2, completedCases: 2, passedCases: 0, results: [], events: [], checks: [
    { id: "secret", type: "command", version: 1, status: "failed", evidence: "verified", required: true, exitCode: 1, category: "assertion", retryable: false, durationMs: 1, cwd: ".", args: ["--password", "opaque-example-123"], stdout: "opaque-example-123" },
    { id: "echo", type: "command", version: 1, status: "failed", evidence: "verified", required: true, exitCode: 1, category: "assertion", retryable: false, durationMs: 1, cwd: ".", stderr: "Another check echoed opaque-example-123" },
  ] };
  expect(JSON.stringify(hostEvidenceOutput(snapshot))).not.toContain("opaque-example-123");
  expect(snapshot.checks![0]!.stdout).toBe("opaque-example-123");
  const summary = boundedReceipt({ v: 1, kind: "canary.repair-verification", outcome: "verified", executed: true, reviewRequired: true, reasons: ["review".repeat(20_000)], beforeRegression: { runId: "run_old", findings: "x".repeat(80_000) }, findings: ["x".repeat(80_000)] });
  expect(summary).toMatchObject({ truncated: true, receipt: { reviewRequired: true, executed: true } });
  expect(JSON.stringify(summary).length).toBeLessThan(10_000);
  expect(boundedReceipt({ v: 1, kind: "canary.change-verification", findings: "中".repeat(30_000) })).toMatchObject({ truncated: true });
  const escaped = "\u0001".repeat(512);
  const observations = { v: 1, kind: escaped, runId: escaped, status: escaped, projectPath: escaped, before: Object.fromEntries(["commit", "indexHash", "trackedStatusHash", "sourceHash", "trackedFilesHash"].map(key => [key, escaped])), after: Object.fromEntries(["commit", "indexHash", "trackedStatusHash", "sourceHash", "trackedFilesHash"].map(key => [key, escaped])) };
  const escapedSummary = boundedReceipt({ v: 1, kind: escaped, outcome: escaped, reasons: Array(16).fill(escaped), reviewRequired: true, executionSources: { original: observations, candidate: observations } });
  expect(Buffer.byteLength(JSON.stringify(escapedSummary))).toBeLessThanOrEqual(65_536);
  expect(escapedSummary.receipt.reviewRequired).toBe(true);
});

it("pairs paginated failures with their own commands after many passing checks", () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "canary-diagnostics-page-")));
  try {
    writeFileSync(join(root, "package.json"), '{"name":"paging-fixture","private":true}');
    const context = resolveProjectContext({ cwd: root }), dir = join(context.artifactRoot, "run_page");
    const run: RunSnapshot = { runId: "run_page", status: "failed", startedAt: "2026-10-01T00:00:00Z", totalCases: 100, completedCases: 100, passedCases: 99, results: [], events: [], checks: Array.from({ length: 100 }, (_, index) => ({ id: `check-${index}`, type: "command", version: 1, status: index === 99 ? "failed" : "passed", evidence: "verified", required: true, exitCode: index === 99 ? 1 : 0, category: index === 99 ? "assertion" : "none", retryable: false, durationMs: 1, cwd: ".", command: "node", args: [`check-${index}.mjs`] })) };
    beginArtifacts(dir); writePrivateJson(join(dir, "run.json"), run); sealArtifacts(dir);
    const ports = bindPorts(context, { readRun: () => run, runHeadless: async () => undefined });
    const result = ports.diagnostics!({ runId: run.runId, maxChecks: 16 }) as { reproduction: { commands: Array<{ checkId: string }> }; page: { nextOffset: number | null } };
    expect(result.reproduction.commands.map(command => command.checkId)).toEqual(["check-99"]);
    expect(result.page.nextOffset).toBeNull();
    run.checks![99]!.args = ["x".repeat(129)];
    run.checks![99]!.stderr = "Error: " + "中".repeat(30_000);
    const large = ports.diagnostics!({ runId: run.runId }) as { reproduction: { commands: Array<{ argumentsTruncated: boolean }> } };
    expect(Buffer.byteLength(JSON.stringify(large))).toBeLessThanOrEqual(65_536);
    expect(large.reproduction.commands[0]!.argumentsTruncated).toBe(true);
    const escaped = "\u0001".repeat(255);
    run.checks![99]!.args = Array.from({ length: 16 }, () => "\u0001".repeat(128));
    run.checks![99]!.stderr = Array.from({ length: 30 }, (_, i) => `FAIL ${escaped}\n at ${escaped}${i}.ts:1:1\n`).join("") + "\u0001".repeat(6000);
    const escapedPage = ports.diagnostics!({ runId: run.runId });
    expect(Buffer.byteLength(JSON.stringify(escapedPage))).toBeLessThanOrEqual(65_536);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
