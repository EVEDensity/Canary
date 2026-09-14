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
  return { v: 1, runId: "run_safe", status: "completed", totalCases: 1, completedCases: 1, passedCases: 1, startedAt: new Date().toISOString(), finishedAt: new Date().