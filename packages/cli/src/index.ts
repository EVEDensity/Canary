#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { missingConfigMessage, resolveProjectContext } from "./home.js";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { RunSnapshot } from "@canary/core";
import { FileArtifactRepository, RunStore } from "@canary/trace";
import { runEvaluation } from "./app.js";
import { renderReport } from "@canary/reporters";
import { compareRuns, holdoutCaseIds, proposeFromResults, writeRegressionDrafts, applySuggestionDecision, verifiedRegressionDrafts, exitCodeForComparison, type ImprovementSuggestion } from "@canary/improvement";
import { parseCanaryConfig, parseReportFormat, parseTestCase } from "@canary/core";
import { hostEvidenceOutput, hostRunOutput, validateHostProposalFile } from "./host.js";
import type { CanaryConfig, CoverageSummary, ProjectContext, TestCase } from "@canary/core";
import { ExperienceStore, type ExperienceInput } from "@canary/experience";

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
}
const USAGE = `Usage: canary run [--headless] [--no-open] [--json] [--case <id>] [--tag <tag>] [--repetitions <n>] [--port <number>] [--config <path>] [--entry <path>]
       canary runs
       canary show <runId>
       canary report <runId> [--format json|markdown|junit|console]
       canary improve <runId> [--out <dir>]
       canary suggest <runId> [--accept|--reject|--verify <id>] [--out <dir>]
       canary candidate <baselineRunId> [--entry <path>] [--headless] [--no-open] [--config <path>]
       canary compare <baselineRunId> <candidateRunId>
       canary replay <runId> [--headless] [--no-open]
       canary host discover [--config <path>]
       canary host evidence <runId> [--case <id>] [--max-cases <n>] [--max-events <n>] [--config <path>]
       canary host validate-proposal <runId> --file <proposal.json> [--config <path>]
       canary experience list [--config <path>]
       canary experience propose --file <experience.json> [--config <path>]
       canary experience validate|activate|revoke|expire <experienceId> [--config <path>]
       canary experience load [--case <id>] [--tag <tag>] [--feature <id>] [--max-items <n>] [--max-chars <n>] [--config <path>]
       canary experience clear [--config <path>]`;

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
      if (normalized[i + 2] === "/") { source += "(?:.*/)?"; i += 2; }
      else { source += ".*"; i += 1; }
    } else if (c === "*") source += "[^/]*";
    else if (c === "?") source += "[^/]";
    else source += /[\\.^$+{}()|[\]]/.test(c) ? `\\${c}` : c;
  }
  return new RegExp(`^${source}$`, "i");
}

export async function discoverCaseFiles(patterns: string | string[], cwd: string, exclude: string[] = []): Promise<string[]> {
  const includes = (Array.isArray(patterns) ? patterns : [patterns]).map((p) => p.replaceAll("\\", "/").replace(/^\.\//, ""));
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
    return includes.some((p) => globToRegExp(p).test(rel) || p === rel || p === file) && !exclude.some((p) => globToRegExp(p).test(rel));
  });
  return [...new Set(matches)].sort((a, b) => a.localeCompare(b));
}

export async function loadCases(pattern: string | string[], cwd: string, exclude: string[] = []): Promise<TestCase[]> {
  const files = await discoverCaseFiles(pattern, cwd, exclude);
  if (!files.length) throw new Error(`No test case files matched: ${Array.isArray(pattern) ? pattern.join(", ") : pattern}`);
  const cases: TestCase[] = [];
  const ids = new Set<string>();
  for (const file of files) {
    const value = defaultExport(await importModule(file));
    const values = Array.isArray(value) ? value : [value];
    for (const candidate of values) {
      let testCase: TestCase;
      try { testCase = parseTestCase(candidate, `TestCase in ${file}`) as TestCase; }
      catch (error) { throw new Error(`Invalid TestCase schema in ${file}: ${error instanceof Error ? error.message : String(error)}`); }
      if (ids.has(testCase.id)) throw new Error(`Duplicate test case id: ${testCase.id}`);
      ids.add(testCase.id);
      cases.push(testCase);
    }
  }
  return cases;
}

export function artifactRoot(cwd?: string, configPath?: string): string {
  return resolveProjectContext({ cwd, configPath }).artifactRoot;
}
export function defaultRegressionDir(cwd?: string, configPath?: string): string {
  const root = resolveProjectContext({ cwd, configPath }).projectRoot;
  if (existsSync(resolve(root, "cases/regression"))) return resolve(root, "cases/regression");
  if (existsSync(resolve(root, "examples/local-agent/cases"))) return resolve(root, "examples/local-agent/cases/regression");
  return resolve(root, "cases/regression");
}
export function listRunArtifacts(cwd?: string, configPath?: string): RunSnapshot[] {
  return new FileArtifactRepository(artifactRoot(cwd, configPath)).listRuns();
}
export function readRunArtifact(runId: string, cwd?: string, configPath?: string): RunSnapshot | undefined {
  const repository = new FileArtifactRepository(artifactRoot(cwd, configPath));
  const run = repository.readRun(runId);
  if (!run) return undefined;
  const coverage = run.coverage ?? repository.readCoverage(runId);
  const improvements = repository.readJson<unknown[]>(runId, "improvement.json");
  return {
    ...run,
    ...(coverage ? { coverage } : {}),
    ...(Array.isArray(improvements) ? { improvements } : {}),
  };
}

function openBrowser(url: string): void {
  if (process.platform === "win32") void import("node:child_process").then(({ spawn }) => spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }));
  else if (process.platform === "darwin") void import("node:child_process").then