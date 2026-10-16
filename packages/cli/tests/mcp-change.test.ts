import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deriveChangeSummary,
  isChangeVerificationV2,
  type ChangeFileAssessment,
  type ChangeVerificationV2,
  type RunSnapshot,
} from "@canary/core";
import { beginArtifacts, FileArtifactRepository, sealArtifacts, stableHash, writePrivateJson } from "@canary/trace";
import { bindPorts, boundedReceipt } from "../src/mcp.js";
import { resolveProjectContext } from "../src/home.js";
import { compatibleMcpVerificationPayload, executeMcpVerification } from "../src/mcp-operations.js";
import type { runCheckProcess } from "../src/check-executor.js";

const processControl = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../src/check-executor.js", async (original) => ({
  ...(await original<typeof import("../src/check-executor.js")>()),
  runCheckProcess: (...args: Parameters<typeof runCheckProcess>) => processControl.run(...args),
}));
const original = await vi.importActual<typeof import("../src/check-executor.js")>("../src/check-executor.js");
const roots: string[] = [];
beforeEach(() => {
  processControl.run.mockImplementation(original.runCheckProcess);
});
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});
const digest = "a".repeat(64),
  commit = "c".repeat(40);
function changedFile(path = "module.mjs"): ChangeFileAssessment {
  return {
    path,
    status: "modified",
    changedLines: [1, 2],
    execution: {
      status: "measured",
      lines: { covered: 1, total: 2 },
      functions: { covered: 1, total: 1 },
      branches: { covered: null, total: null },
      reasons: ["Branch evidence was not collected"],
    },
    uncovered: { lines: [2], functions: [], branches: [] },
    nodes: [],
    behavior: "unknown",
    contracts: [],
    failureEvidence: [],
    interpretation: "Code execution does not establish behavior verification",
  };
}
function project() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "canary MCP R26 ")));
  roots.push(root);
  writeFileSync(join(root, "package.json"), '{"name":"mcp-change-fixture","private":true}');
  const context = resolveProjectContext({ cwd: root }),
    repository = new FileArtifactRepository(context.artifactRoot);
  const run: RunSnapshot = {
    runId: "run_change",
    status: "completed",
    startedAt: "2026-10-16T00:00:00.000Z",
    totalCases: 1,
    completedCases: 1,
    passedCases: 1,
    results: [],
    events: [],
    evidence: {
      v: 1,
      lineage: {},
      reproduction: {
        configHash: "d".repeat(64),
        casesHash: digest,
        sourceHash: digest,
        node: "v24",
        platform: "test",
        arch: "test",
        gitCommit: commit,
        gitDirty: false,
        projectPath: ".",
        lockfiles: {},
        environmentHash: digest,
        environmentNames: [],
        mode: "recorded",
      },
    },
  };
  const fingerprint = {
    commit,
    indexHash: digest,
    trackedStatusHash: digest,
    sourceHash: digest,
    trackedFilesHash: digest,
    commitMatches: true,
  };
  const proof = {
    v: 1,
    kind: "canary.execution-source",
    runId: run.runId,
    status: "unchanged",
    projectPath: ".",
    before: fingerprint,
    after: { ...fingerprint },
  };
  const dir = join(context.artifactRoot, run.runId);
  beginArtifacts(dir);
  writePrivateJson(join(dir, "run.json"), run);
  writePrivateJson(join(dir, "execution-source.json"), proof);
  sealArtifacts(dir, { lineage: run.evidence!.lineage });
  const receipt = (): ChangeVerificationV2 => {
    const source = {
      status: "verified" as const,
      projectPath: ".",
      sourceHash: digest,
      configHash: "d".repeat(64),
      executionSourceHash: stableHash(proof),
      reasons: [],
    };
    const files = [changedFile()];
    return {
      v: 2,
      kind: "canary.change-verification",
      runId: run.runId,
      baseline: "b".repeat(40),
      commit,
      manifestHash: repository.verify(run.runId).manifestHash!,
      source,
      files,
      contracts: [],
      summary: deriveChangeSummary(files, source),
      assessment: "analyzed",
      limitations: ["No inferred behavior guarantees"],
      checks: { planned: 1, executed: 1, passed: 1, failed: 0, blocked: 0, excluded: 0, omitted: 0, missing: 0 },
    };
  };
  const ports = bindPorts(context, { readRun: (id) => repository.readRun(id), runHeadless: async () => undefined });
  return { root, context, repository, run, proof, receipt, ports };
}
const ack = (runId: string) => ({
  v: 1,
  kind: "canary.change-verification-operation",
  runId,
  assessment: "analyzed",
  stored: true,
});
const successfulProcess = { status: "passed", exitCode: 0, processExit: 0, category: "none" };

describe("source-bound MCP change verification", () => {
  it("accepts strict v2 and bounded operation acknowledgements without accepting historical receipts", () => {
    const fixture = project(),
      value = fixture.receipt();
    expect(compatibleMcpVerificationPayload("change-verify", value.runId, value)).toBe(true);
    expect(compatibleMcpVerificationPayload("change-verify", value.runId, ack(value.runId))).toBe(true);
    expect(compatibleMcpVerificationPayload("change-verify", "run_other", value)).toBe(false);
    expect(compatibleMcpVerificationPayload("change-verify", "run_other", ack(value.runId))).toBe(false);
    expect(compatibleMcpVerificationPayload("change-verify", value.runId, { ...value, v: 1 })).toBe(false);
    expect(compatibleMcpVerificationPayload("change-verify", value.runId, { ...ack(value.runId), stored: false })).toBe(
      false,
    );
  });

  it("reads a full bound v2 receipt and rejects changed execution-source evidence", () => {
    const fixture = project(),
      value = fixture.receipt();
    fixture.repository.writeJson(value.runId, "change-verification.json", value);
    expect(fixture.ports.verification!({ runId: value.runId, kind: "change" })).toMatchObject({
      outcome: "analyzed",
      receipt: { v: 2, checks: { executed: 1 } },
    });
    fixture.repository.writeJson(value.runId, "execution-source.json", { ...fixture.proof, status: "changed" });
    expect(fixture.ports.verification!({ runId: value.runId, kind: "change" })).toMatchObject({
      outcome: "evidence-insufficient",
    });
  });

  it("reports legacy change receipts as evidence-insufficient instead of measured", () => {
    const fixture = project(),
      value = fixture.receipt();
    fixture.repository.writeJson(value.runId, "change-verification.json", {
      v: 1,
      kind: value.kind,
      runId: value.runId,
      baseline: value.baseline,
      commit: value.commit,
      manifestHash: value.manifestHash,
      files: [],
      contracts: [],
    });
    expect(fixture.ports.verification!({ runId: value.runId, kind: "change" })).toMatchObject({
      outcome: "evidence-insufficient",
      reason: expect.stringContaining("Historical"),
    });
  });

  it("recognizes only the fixed unavailable record bound to this run", () => {
    const fixture = project(),
      unavailable = {
        v: 1,
        kind: "canary.change-verification-unavailable",
        runId: fixture.run.runId,
        reason: "Change analysis exceeded its supported evidence bounds or its sealed Git inputs are unavailable.",
      };
    fixture.repository.writeJson(fixture.run.runId, "change-verification.json", unavailable);
    const result = fixture.ports.verification!({ runId: fixture.run.runId, kind: "change" });
    expect(result).toMatchObject({
      outcome: "unavailable",
      reason: "Change analysis is unavailable for the retained evidence",
    });
    expect(JSON.stringify(result)).not.toMatch(/Historical|R26/);
    for (const invalid of [
      { ...unavailable, runId: "run_other" },
      { ...unavailable, reason: "arbitrary advisory" },
      { ...unavailable, extra: true },
      { ...unavailable, kind: "canary.unknown" },
      { v: 1, kind: "canary.change-verification", runId: fixture.run.runId },
    ]) {
      fixture.repository.writeJson(fixture.run.runId, "change-verification.json", invalid);
      expect(fixture.ports.verification!({ runId: fixture.run.runId, kind: "change" })).toMatchObject({
        outcome: "unavailable",
        reason: "Receipt is missing or has an unsupported schema",
      });
    }
  });

  it("does not project a valid receipt bound to another configuration", () => {
    const fixture = project(),
      value = fixture.receipt();
    value.source.configHash = "e".repeat(64);
    fixture.repository.writeJson(value.runId, "change-verification.json", value);
    expect(fixture.ports.verification!({ runId: value.runId, kind: "change" })).toMatchObject({
      outcome: "evidence-insufficient",
    });
  });

  it("retains complete counts while marking large views partial and listing omitted gaps", () => {
    const value = project().receipt();
    value.files = Array.from({ length: 150 }, (_, index) => changedFile(`src/module-${index}.mjs`));
    value.summary = deriveChangeSummary(value.files, value.source);
    expect(isChangeVerificationV2(value)).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(value))).toBeGreaterThan(65_536);
    const view = boundedReceipt(value);
    expect(view).toMatchObject({
      truncated: true,
      receipt: {
        v: 2,
        assessment: "analyzed",
        filesOmitted: true,
        partialView: true,
        checks: value.checks,
        source: value.source,
        summary: {
          files: value.summary.files,
          execution: value.summary.execution,
          behavior: value.summary.behavior,
          omittedGaps: value.summary.gaps.length - 12,
        },
      },
    });
    expect((view.receipt as any).summary.gaps).toHaveLength(12);
    expect(view.receipt).not.toHaveProperty("files");
    expect(isChangeVerificationV2(view.receipt)).toBe(false);
    expect(Buffer.byteLength(JSON.stringify(view))).toBeLessThanOrEqual(65_536);
  });

  it("enforces encoded UTF-8 budgets even for escaped source and gap text", () => {
    const value = project().receipt(),
      escaped = "\u0001".repeat(512);
    value.runId = escaped;
    value.summary.gaps = Array.from({ length: 20 }, () => ({
      kind: "missing-coverage",
      path: escaped,
      reason: escaped,
    }));
    value.files = Array.from({ length: 150 }, (_, index) => changedFile(`src/module-${index}.mjs`));
    const view = boundedReceipt(value);
    expect(Buffer.byteLength(JSON.stringify(view))).toBeLessThanOrEqual(65_536);
    expect(view).toMatchObject({ truncated: true, receipt: { v: 2, outcome: "unavailable", evidenceOmitted: true } });
  });

  it("executes fixed summary arguments and returns the newly sealed full receipt", async () => {
    const fixture = project();
    processControl.run.mockImplementation(async (...args: Parameters<typeof runCheckProcess>) => {
      expect(args[1]).toContain("--summary");
      expect(args[1]).toContain("--project");
      expect(args[1]).not.toContain("--config");
      fixture.repository.writeJson(fixture.run.runId, "change-verification.json", fixture.receipt());
      args[7]!(JSON.stringify(ack(fixture.run.runId)));
      return successfulProcess;
    });
    const result = await executeMcpVerification(
      { operation: "change-verify", runId: fixture.run.runId, base: "HEAD^" },
      fixture.context,
      new AbortController().signal,
    );
    expect(result).toMatchObject({
      exitCode: 0,
      outcome: "analyzed",
      receipt: { v: 2, files: [{ path: "module.mjs" }] },
    });
  });

  it("does not replay an old receipt when a process reports success without a new revision", async () => {
    const fixture = project();
    fixture.repository.writeJson(fixture.run.runId, "change-verification.json", fixture.receipt());
    processControl.run.mockImplementation(async (...args: Parameters<typeof runCheckProcess>) => {
      args[7]!(JSON.stringify(ack(fixture.run.runId)));
      return successfulProcess;
    });
    expect(
      await executeMcpVerification(
        { operation: "change-verify", runId: fixture.run.runId, base: "HEAD^" },
        fixture.context,
        new AbortController().signal,
      ),
    ).toMatchObject({ outcome: "evidence-insufficient", reason: expect.stringContaining("new sealed revision") });
  });

  it("rejects a stale receipt even when an unrelated artifact makes a new manifest revision", async () => {
    const fixture = project();
    fixture.repository.writeJson(fixture.run.runId, "change-verification.json", fixture.receipt());
    processControl.run.mockImplementation(async (...args: Parameters<typeof runCheckProcess>) => {
      fixture.repository.writeJson(fixture.run.runId, "unrelated.json", { advisory: true });
      args[7]!(JSON.stringify(ack(fixture.run.runId)));
      return successfulProcess;
    });
    expect(
      await executeMcpVerification(
        { operation: "change-verify", runId: fixture.run.runId, base: "HEAD^" },
        fixture.context,
        new AbortController().signal,
      ),
    ).toMatchObject({ outcome: "evidence-insufficient", reason: expect.stringContaining("bound operation") });
  });

  it.each(["exit", "overflow", "cancel"])("does not read a previous successful receipt after %s", async (failure) => {
    const fixture = project(),
      controller = new AbortController();
    fixture.repository.writeJson(fixture.run.runId, "change-verification.json", fixture.receipt());
    processControl.run.mockImplementation(async (...args: Parameters<typeof runCheckProcess>) => {
      args[7]!(failure === "overflow" ? "中".repeat(30_000) : JSON.stringify(ack(fixture.run.runId)));
      if (failure === "cancel") controller.abort();
      return failure === "exit" ? { ...successfulProcess, processExit: 1 } : successfulProcess;
    });
    const result = await executeMcpVerification(
      { operation: "change-verify", runId: fixture.run.runId, base: "HEAD^" },
      fixture.context,
      controller.signal,
    );
    expect(result).toMatchObject({ outcome: "evidence-insufficient" });
    expect(result).not.toHaveProperty("receipt");
  });

  it("runs config-free historical Git change verification through the real CLI and MCP operation", async () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), "canary MCP real changes ")));
    roots.push(root);
    const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    git("init", "-q");
    git("config", "user.name", "Canary fixture");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "core.autocrlf", "false");
    writeFileSync(join(root, ".gitignore"), ".canary/\n");
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "config-free-changes", private: true, scripts: { test: "node test.mjs" } }),
    );
    writeFileSync(join(root, "module.mjs"), "export const amount = 1;\n");
    writeFileSync(join(root, "test.mjs"), "import assert from 'node:assert/strict'; assert.equal(2+3,5);\n");
    git("add", ".");
    git("commit", "-qm", "Baseline");
    const baseline = git("rev-parse", "HEAD");
    writeFileSync(join(root, "module.mjs"), "export const amount = 2;\n");
    git("add", ".");
    git("commit", "-qm", "Change");
    const invoked = spawnSync(process.execPath, [cli, "run", "--ci"], { cwd: root, encoding: "utf8", timeout: 60_000 });
    expect(invoked.status, invoked.stderr).toBe(0);
    const run = JSON.parse(invoked.stdout);
    const context = resolveProjectContext({ cwd: root }),
      repository = new FileArtifactRepository(context.artifactRoot);
    const result = await executeMcpVerification(
      { operation: "change-verify", runId: run.runId, base: baseline },
      context,
      new AbortController().signal,
    );
    expect(result).toMatchObject({
      exitCode: 0,
      outcome: "analyzed",
      receipt: { v: 2, files: [{ path: "module.mjs" }], source: { status: "verified" }, checks: { executed: 1 } },
    });
    expect(existsSync(join(root, "canary.project.json"))).toBe(false);
    expect(repository.verify(run.runId).status).toBe("verified");
    expect(JSON.parse(readFileSync(join(context.artifactRoot, run.runId, "change-verification.json"), "utf8")).v).toBe(
      2,
    );
    expect(
      bindPorts(context, { readRun: (id) => repository.readRun(id), runHeadless: async () => undefined }).verification!(
        { runId: run.runId, kind: "change" },
      ),
    ).toMatchObject({ outcome: "analyzed" });
  }, 90_000);
});
