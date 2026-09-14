import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildExport, serializeExport, writeExport } from "../src/export.js";
import type { ProjectContext, RunSnapshot } from "@canary/core";

function context(root: string): ProjectContext {
  return { v: 1, invocationRoot: root, projectRoot: root, configRoot: root, configFile: join(root, "canary.config.ts"), artifactRoot: join(root, ".canary", "artifacts"), source: "cwd" };
}
function snapshot(): RunSnapshot {
  return { v: 1, runId: "run_safe", status: "completed", totalCases: 1, completedCases: 1, passedCases: 1, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), results: [{ runId: "run_safe", caseId: "case-safe", executionId: "exec-safe", passed: true, input: "raw input should not export", output: "raw output should not export", assertions: [{ id: "assert-safe", passed: true }], coverage: { runId: "run_safe", sourceHash: "hash", status: "final", lines: { total: 1, covered: 1, pct: 100 }, statements: { total: 1, covered: 1, pct: 100 }, functions: { total: 1, covered: 1, pct: 100 }, branches: { total: 0, covered: 0, pct: 0 } }, trajectory: { id: "t", runId: "run_safe", caseId: "case-safe", events: [], stepCount: 0, termination: "completed" } }], events: [{ type: "run.completed", apiKey: "super-secret", Authorization: "Bearer secret" }] } as unknown as RunSnapshot;
}

describe("export", () => {
  it("redacts secrets and raw content while retaini