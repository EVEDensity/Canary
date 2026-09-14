#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { missingConfigMessage, resolveProjectContext } from "./home.js";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { RunSnapshot } from "@canary/core";
import { FileArtifactRepository, RunStore } from "@canary/trace";
import { runEvaluation } from "./app.js";
import { renderReport } from "@canary/reporters";
import {
  assessSoftTrial,
  compareRuns,
  holdoutCaseIds,
  proposeFromResults,
  writeRegressionDrafts,
  applySuggestionDecision,
  verifiedRegressionDrafts,
  exitCodeForComparison,
  type ImprovementSuggestion,
  type SoftTrialRecord,
} from "@canary/improvement";
import { parseCanaryConfig, parseReportFormat, parseTestCase } from "@canary/core";
import { hostEvidenceOutput, hostRunOutput, validateHostProposalFile } from "./host.js";
import type { CanaryConfig, CoverageSummary, ProjectContext, TestCase } from "@canary/core";
import { ExperienceStore, type ExperienceInput } from "@canary/experience";
import { PolicyStore } from "@canary/policy";
import { PROCESS_BOUNDARY, probeIsolation } from "@canary/isolation";
import { LoopController, createIdlePorts } from "@canary/loop";
import { mcpCommand } from "./mcp.js";
import { controlCommand } from "./control.js";
import { writeExport } from "./export.js";

export interface CliOptions {
  configPath?: string;
  cwd?: string;
  headless?: boolean;
  noOpen?: boolean;
  port?: number;
  caseId?: string;
  caseIds?: string[];
  tags?: string[];
  repetitions?: number;
  replayOf?: string;
  candidateOf?: string;
  entry?: string;
  signal?: AbortSignal;
  json?: boolean;
  experiences?: ExperienceStore;
  suppressOutput?: boolean;
}
const USAGE = `Usage: canary run [--headless] [--no-open] [--json] [--case <id>] [--tag <tag>] [--repetitions <n>] [--port <number>] [--config <path>] [--entry <path>]
       canary runs
       canary show <runId>
       canary report <runId> [--format json|markdown|junit|console]
       canary improve <runId> [--out <dir>]
       canary suggest <runId> [--accept|--reject|--verify <id>] [--out <dir>]
       canary candidate <baselineRunId> [--entry <path>] [--headless] [--no-open] [--config <path>]
       canary compare <baselineRunId> <candidateRunId>
       canary soft-trial prepare <baselineRunId> --experience <experienceId> --regression <caseId> --holdout <caseId>
       canary soft-trial validate|approve|run|rollback <trialId> [--actor <name>] [--reason <text>]
       canary replay <runId> [--headless] [--no-open]
       canary host discover [--config <path>]
       canary host evidence <runId> [--case <id>] [--max-cases <n>] [--max-events <n>] [--config <path>]
       canary host validate-proposal <runId> --file <proposal.json> [--config <path>]
       canary experience list [--config <path>]
       canary experience propose --file <experience.json> [--config <path>]
       canary experience validate|activate|revoke|expire <experienceId> [--config <path>]
       canary experience load [--case <id>] [--tag <tag>] [--feature <id>] [--max-items <n>] [--max-chars <n>] [--config <path>]
       canary experience clear [--config <path>]
       canary isolation probe [--config <path>]
       canary policy show [--config <path>]
       canary loop status|stop|takeover [--reason <text>] [--config <path>]
       canary control status|audit|revision|act|serve [--config <path>]
       canary export --out <file> [--format json|ndjson] [--run <runId>] [--max-runs <n>] [--config <path>]
       canary mcp matrix
       canary mcp serve --token <token> [--config <path>]`;

async function importModule(filePath: string): Promise<Record<string, unknown>> {
  const url = pathToFileURL(resolve(filePath)).href;
  if (/\.[cm]?tsx?$/.test(filePath)) {
    const { tsImport } = await import("tsx/esm/api");
    return tsImport(url, { parentURL: import.meta.url }) as Promise<Record<string, unknown>>;
  }
  return import(url) as Promise<Record<string, unknown>>;
}
function defaultExport(module: Record<string, unknown>): unknown {
  const value = module.default;
  return value && typeof value === "object" && "default" in value ? (value as Record<string, unknown>).default : value;
}
async function loadConfig(configPath: string): Promise<CanaryConfig> {
  return parseCanaryConfig(defaultExport(await importModule(configPath))) as CanaryConfig;
}

/** Double-star globs match zero or more directories: cases/smoke.ts and cases/a/b.ts both match. */
export function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replaceAll("\\", "/").replace(/^\.\//, "");
  let source = "";
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i] ?? "";
    if (c === "*" && normalized[i + 1] === "*") {
      if (normalized[i + 2] === "/") {
        source += "(?:.*/)?";
        i += 2;
      } else {
        source += ".*";
        i += 1;
      }
    } else if (c === "*") source += "[^/]*";
    else if (c === "?") source += "[^/]";
    else source += /[\\.^$+{}()|[\]]/.test(c) ? `\\${c}` : c;
  }
  return new RegExp(`^${source}$`, "i");
}

export async function discoverCaseFiles(
  patterns: string | string[],
  cwd: string,
  exclude: string[] = [],
): Promise<string[]> {
  const includes = (Array.isArray(patterns) ? patterns : [patterns]).map((p) =>
    p.replaceAll("\\", "/").replace(/^\.\//, ""),
  );
  const all: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".canary" || entry.name === "dist") continue;
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/\.(ts|mts|cts|js|mjs)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) all.push(full);
    }
  };
  await walk(cwd);
  const matches = all.filter((file) => {
    const rel = file.slice(cwd.length + 1).replaceAll("\\", "/");
    return (
      includes.some((p) => globToRegExp(p).test(rel) || p === rel || p === file) &&
      !exclude.some((p) => globToRegExp(p).test(rel))
    );
  });
  return [...new Set(matches)].sort((a, b) => a.localeCompare(b));
}

export async function loadCases(pattern: string | string[], cwd: string, exclude: string[] = []): Promise<TestCase[]> {
  const files = await discoverCaseFiles(pattern