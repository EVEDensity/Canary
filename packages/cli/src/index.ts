#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { missingConfigMessage, resolveProjectContext } from "./home.js";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import type { RunSnapshot } from "@canary/core";
import { FileArtifactRepository, RunStore, applyRetention, planRetention, verifyArtifacts, redactValue } from "@canary/trace";
import { projectChecksConfigSchema, ciResultSchema } from "@canary/core";
import { runProjectSession } from "./project-session.js";
import { discoverProject } from "./discovery.js";
import { blocked, runCheckProcess } from "./check-executor.js";
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
import { diagnosticSnapshot, pathsSnapshot, versionSnapshot } from "./diagnostics.js";
import { CliFailure, printCiResult } from "./ci.js";
import { ciExitCodeForRun } from "@canary/core";

export interface CliOptions {
  /** Internal recursion guard for project agent subprocesses. */
  agentCheck?: boolean;
  ci?: boolean;
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
  retryOf?: string;
  entry?: string;
  signal?: AbortSignal;
  json?: boolean;
  experiences?: ExperienceStore;
  suppressOutput?: boolean;
}
const USAGE = `Usage: canary run [--ci] [--headless|--artifacts-only] [--no-open] [--json] [--case <id>] [--tag <tag>] [--repetitions <n>] [--port <number>] [--config <path>] [--entry <path>] [--retry-of <runId>]
       canary discover [--json] [--config <path>]
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
       canary verify <runId> [--json] [--config <path>]
       canary prune [--apply] [--json] [--config <path>]
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
       canary paths|doctor [--json] [--config <path>]
       canary version [--json | --plain]
       canary uninstall
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
  return parseCanaryConfig(await loadRawConfig(configPath)) as CanaryConfig;
}
async function loadRawConfig(configPath: string): Promise<unknown> {
  return configPath.endsWith(".json") ? JSON.parse(readFileSync(configPath, "utf8").replace(/^\uFEFF/, "")) : defaultExport(await importModule(configPath));
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
  const files = await discoverCaseFiles(pattern, cwd, exclude);
  if (!files.length)
    throw new Error(`No test case files matched: ${Array.isArray(pattern) ? pattern.join(", ") : pattern}`);
  const cases: TestCase[] = [];
  const ids = new Set<string>();
  for (const file of files) {
    const value = defaultExport(await importModule(file));
    const values = Array.isArray(value) ? value : [value];
    for (const candidate of values) {
      let testCase: TestCase;
      try {
        testCase = parseTestCase(candidate, `TestCase in ${file}`) as TestCase;
      } catch (error) {
        throw new Error(
          `Invalid TestCase schema in ${file}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
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
  if (existsSync(resolve(root, "examples/local-agent/cases")))
    return resolve(root, "examples/local-agent/cases/regression");
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
  if (process.platform === "win32")
    void import("node:child_process").then(({ spawn }) =>
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }),
    );
  else if (process.platform === "darwin")
    void import("node:child_process").then(({ spawn }) => spawn("open", [url], { detached: true, stdio: "ignore", windowsHide: true }));
  else
    void import("node:child_process").then(({ spawn }) =>
      spawn("xdg-open", [url], { detached: true, stdio: "ignore", windowsHide: true }),
    );
}

function formatCoverage(coverage?: CoverageSummary): string {
  if (!coverage) return "unavailable";
  const part = (key: "lines" | "functions" | "branches" | "statements") =>
    `${key} ${coverage[key].covered}/${coverage[key].total} (${coverage[key].pct}%)`;
  return `${coverage.status} · ${part("lines")} · ${part("functions")} · ${part("branches")} · ${part("statements")}`;
}

export function printRunSummary(
  run: RunSnapshot,
  extras: { artifactPath: string; uiUrl?: string; exitCode: number },
): void {
  const failedCases = Math.max(0, run.completedCases - run.passedCases);
  const assertions = run.results.flatMap((result) => result.assertions);
  const failedAssertions = assertions.filter((item) => !item.passed).length;
  console.log(`runId: ${run.runId}`);
  console.log(`status: ${run.status}`);
  console.log(`cases: ${run.passedCases} passed / ${failedCases} failed / ${run.totalCases} total`);
  console.log(`coverage: ${formatCoverage(run.coverage)}`);
  console.log(`evaluation: ${assertions.length - failedAssertions} passed / ${failedAssertions} failed assertions`);
  console.log(`artifact: ${extras.artifactPath}`);
  if (extras.uiUrl) console.log(`ui: ${extras.uiUrl}`);
  console.log(`exit: ${extras.exitCode}`);
}

function printRunList(runs: RunSnapshot[]): void {
  if (!runs.length) {
    console.log("No runs found.");
    return;
  }
  for (const run of runs) {
    console.log(`${run.runId}\t${run.status}\t${run.passedCases}/${run.totalCases}\t${run.startedAt}`);
  }
}

export interface RunCommandResult {
  exitCode: number;
  runId: string;
  artifactPath: string;
  uiUrl: string;
  snapshot: RunSnapshot;
  store: RunStore;
  close: () => Promise<void>;
}

function flagValue(rest: string[], name: string): string | undefined {
  const index = rest.indexOf(name);
  return index >= 0 ? rest[index + 1] : undefined;
}
function flagValues(rest: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === name && rest[index + 1]) values.push(rest[++index]!);
  }
  return values;
}
function parseRepetitions(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`Invalid --repetitions ${raw}`);
  return value;
}
function selectCases(cases: TestCase[], options: CliOptions): TestCase[] {
  let selected = cases;
  if (options.caseId) selected = selected.filter((testCase) => testCase.id === options.caseId);
  if (options.caseIds?.length) selected = selected.filter((testCase) => options.caseIds!.includes(testCase.id));
  if (options.tags?.length)
    selected = selected.filter((testCase) => (testCase.tags ?? []).some((tag) => options.tags!.includes(tag)));
  if (options.caseId && !selected.length) throw new Error(`No test case matched --case ${options.caseId}`);
  if (options.tags?.length && !selected.length)
    throw new Error(`No test case matched --tag ${options.tags.join(", ")}`);
  if (options.caseIds?.length) {
    const missing = options.caseIds.filter((id) => !selected.some((testCase) => testCase.id === id));
    if (missing.length) throw new Error(`Replay cases not found in current config: ${missing.join(", ")}`);
  }
  return selected;
}

export async function runCommandDetailed(options: CliOptions = {}): Promise<RunCommandResult> {
  if (options.ci) options = { ...options, headless: true, noOpen: true, suppressOutput: true };
  const context = resolveProjectContext(options);
  let raw: unknown;
  if (!existsSync(context.configFile)) throw new CliFailure(2, "CONFIG_NOT_FOUND", missingConfigMessage(context.configFile), "Use canary paths --json and pass --config <existing-canary.config.ts> from the tested project.");
  try { raw = await loadRawConfig(context.configFile); } catch {
    throw new CliFailure(2, "CONFIG_INVALID", "Cannot load project configuration.", missingConfigMessage(context.configFile));
  }
  if (raw && typeof raw === "object" && "kind" in raw && raw.kind === "canary.project") {
    if (options.agentCheck) throw new CliFailure(2, "AGENT_CONFIG_REQUIRED", "An agent check cannot recursively run a project configuration.", "Point the agent check at an agent/cases/coverage configuration in the same project root.");
    const parsed = projectChecksConfigSchema.safeParse(raw);
    if (!parsed.success) throw new CliFailure(2, "PROJECT_CONFIG_INVALID", "Invalid project check schema or dependencies.", "Use version 1, unique IDs, preceding dependencies and at least one required check.");
    return runProjectSession(parsed.data, context, options, async (configFile, signal, env, onPid) => {
      if (resolve(configFile, "..") !== context.projectRoot) return blocked(2, "configuration");
      // Import the trusted agent config only inside the cancellable child process.
      const entry = fileURLToPath(import.meta.url);
      const result = await runCheckProcess(process.execPath, [...(entry.endsWith(".ts") ? ["--import", pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href] : []), entry, "run", "--ci", "--agent-check", "--config", configFile], context.projectRoot, env, signal, onPid);
      if (result.exitCode !== 0) return result;
      let ci;
      try { ci = ciResultSchema.parse(JSON.parse(result.stdout ?? "")); } catch { return { ...result, ...blocked(10, "internal") }; }
      if (result.processExit !== ci.exitCode) return { ...result, ...blocked(10, "internal") };
      const categories = { 0: "none", 1: "assertion", 2: "configuration", 3: "timeout", 4: "environment", 5: "artifact", 6: "policy", 10: "internal" } as const;
      const integrity = ci.artifactPath ? verifyArtifacts(resolve(ci.artifactPath, "..")) : undefined;
      if (ci.artifactPath && integrity?.status !== "verified") return { ...result, ...blocked(5, "artifact") };
      return { ...result, status: ci.exitCode === 0 ? "passed" : ci.exitCode === 1 ? "failed" : "blocked", exitCode: ci.exitCode, category: categories[ci.exitCode], ...(ci.runId && ci.artifactPath && integrity?.manifestHash ? { childRun: { runId: ci.runId, artifactPath: ci.artifactPath, manifestHash: integrity.manifestHash } } : {}) };
    }, openBrowser);
  }
  let config: CanaryConfig;
  let cases: TestCase[];
  let selected: TestCase[];
  try {
    if (!existsSync(context.configFile)) throw new CliFailure(2, "CONFIG_NOT_FOUND", missingConfigMessage(context.configFile), "Use canary paths --json and pass --config <existing-canary.config.ts> from the tested project.");
    config = parseCanaryConfig(raw) as CanaryConfig;
    cases = await loadCases(config.cases, context.projectRoot, config.coverage.exclude);
    selected = selectCases(cases, options);
    if (options.ci && !selected.length) throw new CliFailure(2, "NO_CASES", "No cases selected; CI cannot pass an empty run.", "Check the cases glob and filters in the trusted project configuration.");
    if (options.ci && config.agent.adapter === "function") {
      const entry = resolve(context.projectRoot, options.entry ?? config.agent.entry);
      if (!existsSync(entry) || !statSync(entry).isFile()) throw new CliFailure(2, "AGENT_ENTRY_MISSING", "The configured function-agent entry is not a file.", "Correct agent.entry or --entry relative to projectRoot.");
    }
  } catch (error) {
    if (!options.ci || error instanceof CliFailure) throw error;
    throw new CliFailure(2, "CONFIG_INVALID", "Cannot load or validate the project configuration or cases.", "Check the config/case schema, imports, case IDs and selectors. Config modules are trusted executable code; secret-bearing exceptions are not printed.");
  }
  if (options.ci) {
    // Force machine reports even when the developer selected console-only reporters.
    config = { ...config, reporters: [...new Set([...(config.reporters ?? []), "json", "junit"] as const)] };
    try {
      mkdirSync(context.artifactRoot, { recursive: true });
      const probe = resolve(context.artifactRoot, `.write-probe-${randomUUID()}`);
      writeFileSync(probe, "", { flag: "wx" });
      unlinkSync(probe);
    } catch {
      throw new CliFailure(5, "ARTIFACT_UNWRITABLE", "The project artifact collection is not writable.", "Check artifactRoot permissions, directory type and available disk space; do not delete historical runs.");
    }
  }
  const store = new RunStore();
  const runId = `run_${randomUUID()}`;
  const fallbackReps = options.repetitions ?? config.runtime?.repetitions ?? 1;
  const planned = selected.reduce((sum, testCase) => sum + (testCase.options?.repetitions ?? fallbackReps), 0);
  store.create(planned, runId, options.replayOf);
  const evaluationInput = {
    store,
    config: options.entry ? { ...config, agent: { ...config.agent, entry: options.entry } } : config,
    context,
    selected,
    replayOf: options.replayOf,
    candidateOf: options.candidateOf,
    retryOf: options.retryOf,
    repetitions: options.repetitions,
    signal: options.signal,
    experiences: options.experiences,
    consoleReporter: Boolean(config.reporters?.includes("console")),
    silent: options.json || options.suppressOutput || options.ci,
    runId,
  };
  const webEnabled = !options.headless && config.web?.enabled !== false;
  let uiUrl = "";
  let close = async (): Promise<void> => {
    /* no listener */
  };
  if (webEnabled) {
    const { createWebServer } = await import("@canary/web");
    const writeToken = randomUUID();
    const web = createWebServer(
      store,
      config.web?.host ?? "127.0.0.1",
      options.port ?? config.web?.port ?? 0,
      context.artifactRoot,
      {
        writeToken,
        onReplay: async (sourceId, request) => {
          const source = store.get(sourceId);
          if (!source) throw new Error(`Run not found: ${sourceId}`);
          const wanted = request.caseId
            ? [request.caseId]
            : [...new Set(source.results.map((result) => result.caseId))];
          const replayCases = cases.filter((testCase) => wanted.includes(testCase.id));
          if (!replayCases.length) throw new Error("No cases to replay");
          const replayed = await runEvaluation({
            ...evaluationInput,
            selected: replayCases,
            replayOf: sourceId,
            runId: undefined,
          });
          return { replayRunId: replayed.runId };
        },
      },
    );
    const listening = await web.listen();
    uiUrl = `${listening.url}/?runId=${encodeURIComponent(runId)}&token=${encodeURIComponent(writeToken)}`;
    if (!options.json && !options.suppressOutput) {
      console.log(`runId: ${runId}`);
      console.log(`canary UI: ${uiUrl}`);
    }
    if (!options.noOpen && config.web?.open !== false) openBrowser(uiUrl);
    let webClosed = false;
    close = async (): Promise<void> => {
      if (webClosed || !web.server.listening) {
        webClosed = true;
        return;
      }
      await new Promise<void>((resolveClose, rejectClose) =>
        web.server.close((error) => (error ? rejectClose(error) : resolveClose())),
      );
      webClosed = true;
    };
  } else if (!options.json && !options.suppressOutput) {
    console.log(`runId: ${runId}`);
  }
  const executed = await runEvaluation(evaluationInput);
  if (options.ci) executed.exitCode = ciExitCodeForRun(executed.snapshot, executed.exitCode);
  if (options.json && !options.suppressOutput) {
    console.log(JSON.stringify(hostRunOutput(context, executed.snapshot, executed.artifactPath, executed.exitCode)));
  } else if (!options.suppressOutput) {
    printRunSummary(executed.snapshot, {
      artifactPath: executed.artifactPath,
      uiUrl: uiUrl || undefined,
      exitCode: executed.exitCode,
    });
  }
  return {
    exitCode: executed.exitCode,
    runId: executed.runId,
    artifactPath: executed.artifactPath,
    uiUrl,
    snapshot: executed.snapshot,
    store,
    close,
  };
}
export async function runCommand(options: CliOptions = {}): Promise<number> {
  return (await runCommandDetailed(options)).exitCode;
}

function parseArgv(argv: string[]): { command: string; rest: string[] } {
  const args = argv.filter((item) => item !== "--");
  const command = args[0] && !args[0].startsWith("-") ? args[0] : "run";
  return { command, rest: command === args[0] ? args.slice(1) : args };
}

export {
  CANARY_HOME_FILE,
  missingConfigMessage,
  readInstalledHome,
  resolveCanaryProjectRoot,
  resolveConfigFile,
  resolveProjectContext,
} from "./home.js";

function parseBoundedInteger(raw: string | undefined, name: string): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`Invalid ${name} ${raw}`);
  return value;
}

function printHost(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function experienceStoreFor(configPath?: string): { context: ProjectContext; store: ExperienceStore } {
  const context = resolveProjectContext({ configPath });
  return { context, store: new ExperienceStore(resolve(context.projectRoot, ".canary", "experiences")) };
}

function experienceOutput(kind: string, value: unknown): void {
  printHost({ v: 1, kind, ...(isRecord(value) ? value : { value }) });
}

async function experienceCommand(rest: string[], configPath?: string): Promise<number> {
  const action = rest[0];
  const { context, store } = experienceStoreFor(configPath);
  if (action === "list") {
    experienceOutput("canary.experience.list", {
      projectRoot: context.projectRoot,
      active: store.activePointer(context.projectRoot),
      records: store.list(),
    });
    return 0;
  }
  if (action === "propose") {
    const file = flagValue(rest, "--file");
    if (!file) {
      console.log(USAGE);
      return 1;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(resolve(context.invocationRoot, file), "utf8"));
    } catch (error) {
      experienceOutput("canary.experience.proposal", {
        valid: false,
        errors: [`Experience file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`],
      });
      return 1;
    }
    if (!isRecord(raw)) {
      experienceOutput("canary.experience.proposal", { valid: false, errors: ["Experience must be a JSON object"] });
      return 1;
    }
    const declaredRoot = typeof raw.projectRoot === "string" ? resolve(raw.projectRoot) : context.projectRoot;
    if (declaredRoot !== context.projectRoot) {
      experienceOutput("canary.experience.proposal", {
        valid: false,
        errors: ["Experience projectRoot must match the selected project"],
      });
      return 1;
    }
    try {
      const input: ExperienceInput = {
        key: String(raw.key ?? ""),
        projectRoot: context.projectRoot,
        source:
          isRecord(raw.source) && typeof raw.source.kind === "string"
            ? {
                kind: raw.source.kind as ExperienceInput["source"]["kind"],
                ...(typeof raw.source.ref === "string" ? { ref: raw.source.ref } : {}),
              }
            : { kind: "human" },
        summary: String(raw.summary ?? ""),
        content: String(raw.content ?? ""),
        counterexamples: Array.isArray(raw.counterexamples)
          ? raw.counterexamples.filter((item): item is string => typeof item === "string")
          : [],
        scope: isRecord(raw.scope)
          ? {
              caseIds: Array.isArray(raw.scope.caseIds)
                ? raw.scope.caseIds.filter((item): item is string => typeof item === "string")
                : undefined,
              tags: Array.isArray(raw.scope.tags)
                ? raw.scope.tags.filter((item): item is string => typeof item === "string")
                : undefined,
              featureIds: Array.isArray(raw.scope.featureIds)
                ? raw.scope.featureIds.filter((item): item is string => typeof item === "string")
                : undefined,
            }
          : undefined,
        expiresAt: typeof raw.expiresAt === "string" ? raw.expiresAt : undefined,
        expiryReason: typeof raw.expiryReason === "string" ? raw.expiryReason : undefined,
      };
      const record = store.propose(input);
      experienceOutput("canary.experience.proposal", { valid: true, record, approval: { status: "not_approved" } });
      return 0;
    } catch (error) {
      experienceOutput("canary.experience.proposal", {
        valid: false,
        errors: [error instanceof Error ? error.message : String(error)],
        approval: { status: "not_approved" },
      });
      return 1;
    }
  }
  if (["validate", "activate", "revoke", "expire"].includes(action ?? "")) {
    const id = rest[1];
    if (!id) {
      console.log(USAGE);
      return 1;
    }
    try {
      const record =
        action === "validate"
          ? store.transition(id, "validated")
          : action === "activate"
            ? store.activate(id)
            : action === "revoke"
              ? store.revoke(id)
              : store.transition(id, "expired", "expired by operator");
      experienceOutput(`canary.experience.${action}`, { record, approval: { status: "not_approved" } });
      return 0;
    } catch (error) {
      experienceOutput(`canary.experience.${action}`, {
        valid: false,
        errors: [error instanceof Error ? error.message : String(error)],
        approval: { status: "not_approved" },
      });
      return 1;
    }
  }
  if (action === "clear") {
    store.clear(context.projectRoot);
    experienceOutput("canary.experience.clear", {
      projectRoot: context.projectRoot,
      active: store.activePointer(context.projectRoot),
    });
    return 0;
  }
  if (action === "load") {
    try {
      const loaded = store.load({
        projectRoot: context.projectRoot,
        caseId: flagValue(rest, "--case"),
        tags: flagValues(rest, "--tag"),
        featureIds: flagValues(rest, "--feature"),
        maxItems: parseBoundedInteger(flagValue(rest, "--max-items"), "--max-items"),
        maxChars: parseBoundedInteger(flagValue(rest, "--max-chars"), "--max-chars"),
      });
      experienceOutput("canary.experience.load", {
        projectRoot: context.projectRoot,
        loaded: loaded.loaded.map(({ content: _content, ...reference }) => reference),
        skipped: loaded.skipped,
        totalChars: loaded.totalChars,
      });
      return 0;
    } catch (error) {
      experienceOutput("canary.experience.load", {
        valid: false,
        errors: [error instanceof Error ? error.message : String(error)],
      });
      return 1;
    }
  }
  console.log(USAGE);
  return 1;
}

function softTrialDir(context: ProjectContext, trialId: string): string {
  return resolve(context.artifactRoot, "soft-trials", trialId);
}
function softTrialFile(context: ProjectContext, trialId: string): string {
  return resolve(softTrialDir(context, trialId), "trial.json");
}
function readSoftTrial(context: ProjectContext, trialId: string): SoftTrialRecord | undefined {
  try {
    return JSON.parse(readFileSync(softTrialFile(context, trialId), "utf8")) as SoftTrialRecord;
  } catch {
    return undefined;
  }
}
function writeSoftTrial(context: ProjectContext, record: SoftTrialRecord): void {
  mkdirSync(softTrialDir(context, record.id), { recursive: true });
  writeFileSync(softTrialFile(context, record.id), JSON.stringify(record, null, 2), "utf8");
}
function softTrialOutput(value: unknown): void {
  printHost({ v: 1, kind: "canary.soft-trial", ...(isRecord(value) ? value : { value }) });
}
function softTrialDatasetIdentity(results: RunSnapshot["results"]): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        results.map((result) => ({
          id: result.caseId,
          repetition: result.repetition,
          dataset: result.sourceCase?.dataset ?? null,
        })),
      ),
    )
    .digest("hex");
}

async function softTrialCommand(rest: string[], configPath?: string): Promise<number> {
  const action = rest[0];
  const { context, store } = experienceStoreFor(configPath);
  const trialId = rest[1];
  if (action === "prepare") {
    const baselineId = rest[1];
    const experienceId = flagValue(rest, "--experience");
    const regressionCaseIds = [...new Set(flagValues(rest, "--regression"))];
    const holdoutIds = [...new Set(flagValues(rest, "--holdout"))];
    if (!baselineId || !experienceId || !regressionCaseIds.length || !holdoutIds.length) {
      console.log(USAGE);
      return 1;
    }
    const baseline = readRunArtifact(baselineId, undefined, configPath);
    const experience = store.get(experienceId);
    if (!baseline || !experience) {
      softTrialOutput({
        valid: false,
        status: "rejected",
        errors: [!baseline ? "Run not found: " + baselineId : "Experience not found: " + experienceId],
      });
      return 1;
    }
    const selectedIds = [...new Set([...regressionCaseIds, ...holdoutIds])];
    const known = new Set(baseline.results.map((result) => result.caseId));
    const missing = selectedIds.filter((id) => !known.has(id));
    const overlap = regressionCaseIds.filter((id) => holdoutIds.includes(id));
    if (missing.length || overlap.length) {
      softTrialOutput({
        valid: false,
        status: "rejected",
        errors: [
          ...(missing.length ? ["Unknown baseline cases: " + missing.join(", ")] : []),
          ...(overlap.length ? ["Cases cannot be both regression and holdout: " + overlap.join(", ")] : []),
        ],
      });
      return 1;
    }
    if (experience.projectRoot !== context.projectRoot || !["validated", "active"].includes(experience.status)) {
      softTrialOutput({
        valid: false,
        status: "rejected",
        errors: [
          "Experience must be project-scoped and validated before trial; accepted/verified fields are not execution evidence",
        ],
      });
      return 1;
    }
    const selectedResults = baseline.results.filter((result) => selectedIds.includes(result.caseId));
    const maxCases = parseBoundedInteger(flagValue(rest, "--max-cases"), "--max-cases") ?? selectedIds.length;
    const maxChars = parseBoundedInteger(flagValue(rest, "--max-chars"), "--max-chars") ?? 8_000;
    if (selectedIds.length > maxCases || experience.content.length > maxChars) {
      softTrialOutput({ valid: false, status: "rejected", errors: ["Trial budget exceeded"] });
      return 1;
    }
    const id = "soft_trial_" + randomUUID();
    const record: SoftTrialRecord = {
      v: 1,
      id,
      projectRoot: context.projectRoot,
      configPath: context.configFile,
      baselineRunId: baselineId,
      experienceId,
      experienceContentHash: experience.contentHash,
      datasetIdentity: softTrialDatasetIdentity(selectedResults),
      regressionCaseIds,
      holdoutCaseIds: holdoutIds,
      budget: { maxCases, maxChars },
      status: "prepared",
      authorization: {
        status: "not_approved",
        reason: "Preparation is not authorization; validation must be independent and human approval is separate.",
      },
      priorActive: store.activePointer(context.projectRoot),
    };
    writeSoftTrial(context, record);
    softTrialOutput({ valid: true, action, record });
    return 0;
  }
  if (!trialId) {
    console.log(USAGE);
    return 1;
  }
  const record = readSoftTrial(context, trialId);
  if (!record) {
    softTrialOutput({ valid: false, status: "rejected", errors: ["Soft trial not found: " + trialId] });
    return 1;
  }
  const experience = store.get(record.experienceId);
  if (!experience) {
    softTrialOutput({ valid: false, status: "rejected", errors: ["Experience not found: " + record.experienceId] });
    return 1;
  }
  if (action === "validate") {
    if (record.status !== "prepared") {
      softTrialOutput({ valid: false, status: "rejected", errors: ["Trial must be prepared, found " + record.status] });
      return 1;
    }
    const baseline = readRunArtifact(record.baselineRunId, undefined, configPath);
    if (!baseline) {
      softTrialOutput({ valid: false, status: "rejected", errors: ["Run not found: " + record.baselineRunId] });
      return 1;
    }
    const selectedIds = [...new Set([...record.regressionCaseIds, ...record.holdoutCaseIds])];
    const selectedResults = baseline.results.filter((result) => selectedIds.includes(result.caseId));
    const baselineSubset: RunSnapshot = {
      ...baseline,
      results: selectedResults,
      totalCases: selectedResults.length,
      completedCases: selectedResults.length,
      passedCases: selectedResults.filter((result) => result.passed).length,
    };
    const isolated = new ExperienceStore(resolve(softTrialDir(context, record.id), "experiences"));
    isolated.importRecord(experience);
    if (["proposed", "active"].includes(experience.status)) isolated.transition(experience.id, "validated");
    if (isolated.get(experience.id)?.status === "validated") isolated.activate(experience.id);
    let executed: RunCommandResult | undefined;
    try {
      executed = await runCommandDetailed({
        configPath,
        headless: true,
        noOpen: true,
        json: true,
        suppressOutput: true,
        caseIds: selectedIds,
        candidateOf: record.baselineRunId,
        experiences: isolated,
      });
      const candidate = executed.snapshot;
      const comparison = compareRuns(baselineSubset, candidate, holdoutCaseIds(candidate.results));
      const comparisonPath = resolve(softTrialDir(context, record.id), "comparison.json");
      writeFileSync(comparisonPath, JSON.stringify(comparison, null, 2), "utf8");
      const validation = assessSoftTrial({
        baseline: baselineSubset,
        candidate,
        comparison,
        regressionCaseIds: record.regressionCaseIds,
        holdoutCaseIds: record.holdoutCaseIds,
        candidateExitCode: executed.exitCode,
        comparisonArtifact: comparisonPath,
      });
      writeFileSync(
        resolve(softTrialDir(context, record.id), "validation.json"),
        JSON.stringify(validation, null, 2),
        "utf8",
      );
      const next: SoftTrialRecord = {
        ...record,
        status: validation.valid ? "validated" : "rejected",
        budget: { ...record.budget, observedCases: candidate.results.length, observedChars: experience.content.length },
        validation,
      };
      writeSoftTrial(context, next);
      softTrialOutput({ valid: validation.valid, action, record: next, comparison });
      return validation.valid ? 0 : 1;
    } finally {
      await executed?.close();
    }
  }
  if (action === "approve") {
    if (record.status !== "validated" || !record.validation?.valid) {
      softTrialOutput({
        valid: false,
        status: "rejected",
        errors: ["Only a valid independent trial can be manually approved"],
      });
      return 1;
    }
    const actor = flagValue(rest, "--actor");
    const reason = flagValue(rest, "--reason");
    if (!actor || !reason) {
      softTrialOutput({ valid: false, status: "rejected", errors: ["Manual approval requires --actor and --reason"] });
      return 1;
    }
    const next: SoftTrialRecord = {
      ...record,
      status: "approved",
      authorization: { status: "approved", actor, reason, approvedAt: new Date().toISOString() },
    };
    writeSoftTrial(context, next);
    softTrialOutput({ valid: true, action, record: next });
    return 0;
  }
  if (action === "run") {
    const { ControlPlane } = await import("@canary/control-plane");
    new ControlPlane(context.projectRoot, context.artifactRoot).assertSoftApproval(trialId);
    if (record.status !== "approved" || record.authorization.status !== "approved") {
      softTrialOutput({
        valid: false,
        status: "rejected",
        errors: ["Trial must have independent validation and explicit human approval before activation"],
      });
      return 1;
    }
    const prior = record.priorActive ?? store.activePointer(context.projectRoot);
    if (experience.status === "validated") store.activate(experience.id);
    let executed: RunCommandResult | undefined;
    try {
      executed = await runCommandDetailed({
        configPath,
        headless: true,
        noOpen: true,
        json: true,
        suppressOutput: true,
        caseIds: [...new Set([...record.regressionCaseIds, ...record.holdoutCaseIds])],
      });
      const next: SoftTrialRecord = { ...record, status: "activated", nextRunId: executed.runId };
      writeSoftTrial(context, next);
      softTrialOutput({
        valid: executed.exitCode === 0,
        action,
        record: next,
        loadedExperienceIds: executed.snapshot.experiences?.map((item) => item.id) ?? [],
        sourceUnchanged: true,
      });
      return executed.exitCode;
    } catch (error) {
      store.restorePointer(prior);
      throw error;
    } finally {
      await executed?.close();
    }
  }
  if (action === "rollback") {
    if (record.status !== "activated") {
      softTrialOutput({ valid: false, status: "rejected", errors: ["Only an activated trial can be rolled back"] });
      return 1;
    }
    const current = store.get(record.experienceId);
    if (current?.status === "active") store.transition(record.experienceId, "validated", "S-04 rollback");
    store.restorePointer(
      record.priorActive ?? {
        v: 1,
        projectRoot: context.projectRoot,
        entries: [],
        updatedAt: new Date().toISOString(),
      },
    );
    const next: SoftTrialRecord = {
      ...record,
      status: "rolled_back",
      authorization: {
        ...record.authorization,
        reason: (record.authorization.reason ?? "approved") + "; rolled back by operator",
      },
    };
    writeSoftTrial(context, next);
    softTrialOutput({
      valid: true,
      action,
      record: next,
      active: store.activePointer(context.projectRoot),
      loaded: store.load({ projectRoot: context.projectRoot }).loaded.map((item) => item.id),
    });
    return 0;
  }
  softTrialOutput({ valid: false, status: "rejected", errors: ["Unknown soft-trial action: " + (action ?? "")] });
  return 1;
}

async function hostCommand(rest: string[], configPath?: string): Promise<number> {
  const action = rest[0];
  if (action === "discover") {
    const context = resolveProjectContext({ configPath });
    printHost({
      v: 1,
      kind: "canary.host.discovery",
      project: {
        projectRoot: context.projectRoot,
        configFile: context.configFile,
        artifactRoot: context.artifactRoot,
        source: context.source,
        configExists: existsSync(context.configFile),
      },
      writableSourceRequested: false,
    });
    return existsSync(context.configFile) ? 0 : 1;
  }
  if (action === "evidence") {
    const runId = rest[1];
    if (!runId) {
      console.log(USAGE);
      return 1;
    }
    const snapshot = readRunArtifact(runId, undefined, configPath);
    if (!snapshot) {
      printHost({ v: 1, kind: "canary.host.evidence", error: `Run not found: ${runId}` });
      return 1;
    }
    try {
      printHost(
        hostEvidenceOutput(snapshot, {
          caseId: flagValue(rest, "--case"),
          maxCases: parseBoundedInteger(flagValue(rest, "--max-cases"), "--max-cases"),
          maxEventsPerCase: parseBoundedInteger(flagValue(rest, "--max-events"), "--max-events"),
        }),
      );
      return 0;
    } catch (error) {
      printHost({ v: 1, kind: "canary.host.evidence", error: error instanceof Error ? error.message : String(error) });
      return 1;
    }
  }
  if (action === "validate-proposal") {
    const runId = rest[1];
    const file = flagValue(rest, "--file");
    if (!runId || !file) {
      console.log(USAGE);
      return 1;
    }
    const snapshot = readRunArtifact(runId, undefined, configPath);
    if (!snapshot) {
      printHost({
        v: 1,
        kind: "canary.host.proposal-validation",
        valid: false,
        status: "rejected",
        errors: [`Run not found: ${runId}`],
      });
      return 1;
    }
    const context = resolveProjectContext({ configPath });
    const proposalPath = resolve(context.invocationRoot, file);
    const validation = validateHostProposalFile(proposalPath, snapshot, context.artifactRoot);
    printHost(validation);
    return validation.valid ? 0 : 1;
  }
  console.log(USAGE);
  return 1;
}

function isolationCommand(rest: string[], configPath?: string): number {
  const action = rest[0] ?? "probe";
  const context = resolveProjectContext({ configPath });
  if (action !== "probe") {
    console.log(USAGE);
    return 1;
  }
  printHost({
    v: 1,
    kind: "canary.isolation.probe",
    capability: probeIsolation(),
    boundary: PROCESS_BOUNDARY,
    projectRoot: context.projectRoot,
  });
  return 0;
}

function policyCommand(rest: string[], configPath?: string): number {
  const action = rest[0] ?? "show";
  const context = resolveProjectContext({ configPath });
  if (action !== "show") {
    console.log(USAGE);
    return 1;
  }
  const store = new PolicyStore(context.projectRoot);
  printHost({ v: 1, kind: "canary.policy", policy: store.loadOrCreate(context.projectRoot) });
  return 0;
}

function loopCommand(rest: string[], configPath?: string): number {
  const action = rest[0] ?? "status";
  const context = resolveProjectContext({ configPath });
  const controller = new LoopController(context.projectRoot, createIdlePorts());
  if (action === "status") {
    printHost({ v: 1, kind: "canary.loop", snapshot: controller.getState() });
    return 0;
  }
  if (action === "stop") {
    printHost({ v: 1, kind: "canary.loop", snapshot: controller.stop(flagValue(rest, "--reason") ?? "cli stop") });
    return 0;
  }
  if (action === "takeover") {
    printHost({
      v: 1,
      kind: "canary.loop",
      snapshot: controller.takeover(flagValue(rest, "--reason") ?? "human takeover"),
    });
    return 0;
  }
  console.log(USAGE);
  return 1;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const { command, rest } = parseArgv(argv);
  const configPath = flagValue(rest, "--config");
  if (command === "run" && rest.includes("--ci")) return printCiResult(rest, runCommandDetailed);
  if (command === "discover") {
    if (rest.some((flag, i) => flag !== "--json" && flag !== "--config" && rest[i - 1] !== "--config") || (rest.includes("--config") && !configPath)) return 2;
    try {
      const discovery = discoverProject(resolveProjectContext({ configPath }).projectRoot);
      console.log(JSON.stringify(redactValue(discovery)));
      return discovery.status === "blocked" ? 2 : 0;
    } catch { console.error("Cannot read project discovery markers."); return 2; }
  }
  if (command === "host") return hostCommand(rest, configPath);
  if (command === "soft-trial") return softTrialCommand(rest, configPath);
  if (command === "experience") return experienceCommand(rest, configPath);
  if (command === "isolation") return isolationCommand(rest, configPath);
  if (command === "policy") return policyCommand(rest, configPath);
  if (command === "loop") return loopCommand(rest, configPath);
  if (command === "control") return controlCommand(rest, configPath);
  if (command === "paths" || command === "doctor" || command === "version") {
    const allowed = new Set(command === "version" ? ["--json", "--plain"] : ["--json", "--config"]);
    for (let i = 0; i < rest.length; i++) {
      const flag = rest[i]!;
      if (!allowed.has(flag) || (flag === "--config" && (!rest[i + 1] || rest[i + 1]!.startsWith("--")))) {
        console.error("Invalid diagnostic arguments. Use canary help."); return 2;
      }
      if (flag === "--config") i++;
    }
    if (command === "version") {
      if (rest.includes("--plain") && rest.includes("--json")) { console.error("Choose --plain or --json."); return 2; }
      const version = versionSnapshot();
      console.log(rest.includes("--json") ? JSON.stringify(version) : version.canaryVersion);
      return 0;
    }
    const payload =
      command === "paths" ? pathsSnapshot(undefined, configPath) : await diagnosticSnapshot(undefined, configPath);
    console.log(JSON.stringify(payload, null, rest.includes("--json") ? undefined : 2));
    return "exitCode" in payload ? payload.exitCode : 0;
  }
  if (command === "uninstall") {
    console.log("Use uninstall.ps1 on Windows or uninstall.sh on macOS/Linux to remove the global launcher safely.");
    return 0;
  }
  if (command === "repair") {
    try {
      const home = resolve(process.env.CANARY_HOME ?? "");
      console.log(JSON.stringify({ repaired: Boolean(home), action: "re-run install-global or upgrade-global to rebuild metadata and launcher" }, null, 2));
      return 0;
    } catch (error) { console.error(error instanceof Error ? error.message : String(error)); return 1; }
  }
  if (command === "export") {
    const output = flagValue(rest, "--out");
    if (!output) {
      console.log(USAGE);
      return 1;
    }
    try {
      const manifest = writeExport(resolveProjectContext({ configPath }), output, {
        format: (flagValue(rest, "--format") as "json" | "ndjson" | undefined) ?? "json",
        runIds: flagValues(rest, "--run"),
        maxRuns: flagValue(rest, "--max-runs") ? Number(flagValue(rest, "--max-runs")) : undefined,
      });
      console.log(JSON.stringify({ kind: "canary.export", manifest }, null, 2));
      return 0;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }

  if (command === "mcp") {
    return mcpCommand(rest, configPath, {
      readRun: (runId, context) => readRunArtifact(runId, context.projectRoot, context.configFile),
      runHeadless: async ({ context, caseId, signal }) => {
        const result = await runCommandDetailed({
          cwd: context.projectRoot,
          configPath: context.configFile,
          headless: true,
          noOpen: true,
          suppressOutput: true,
          caseId,
          signal,
        });
        return hostRunOutput(context, result.snapshot, result.artifactPath, result.exitCode);
      },
    });
  }
  if (command === "help") {
    console.log(USAGE);
    return 0;
  }
  if (command === "verify") {
    if (!rest[0] || rest[0].startsWith("--")) { console.error("Usage: canary verify <runId> [--json] [--config <path>]"); return 2; }
    const result = new FileArtifactRepository(artifactRoot(undefined, configPath)).verify(rest[0]);
    console.log(rest.includes("--json") ? JSON.stringify(result) : `${result.runId}: ${result.status}${result.issues.length ? ` (${result.issues.map((item) => `${item.code}: ${item.path}`).join("; ")})` : ""}`);
    return result.status === "verified" ? 0 : 5;
  }
  if (command === "prune") {
    const context = resolveProjectContext({ configPath });
    const config = await loadConfig(context.configFile);
    const policy = config.artifacts?.retention;
    if (!policy || !Object.keys(policy).length) { console.error("Configure artifacts.retention before pruning historical runs."); return 2; }
    const plan = planRetention(context.artifactRoot, policy);
    const removed = rest.includes("--apply") ? applyRetention(context.artifactRoot, plan) : [];
    console.log(JSON.stringify({ ...plan, mode: rest.includes("--apply") ? "apply" : "preview", removed }));
    return 0;
  }
  if (command === "runs") {
    printRunList(listRunArtifacts(undefined, configPath));
    return 0;
  }
  if (command === "show") {
    const runId = rest[0];
    if (!runId) {
      console.log(USAGE);
      return 1;
    }
    const snapshot = readRunArtifact(runId, undefined, configPath);
    if (!snapshot) {
      console.error(`Run not found: ${runId}`);
      return 1;
    }
    printRunSummary(snapshot, {
      artifactPath: resolve(artifactRoot(undefined, configPath), runId, "run.json"),
      exitCode: snapshot.status === "completed" ? 0 : 1,
    });
    return snapshot.status === "completed" ? 0 : 1;
  }
  if (command === "report") {
    const runId = rest[0];
    if (!runId) {
      console.log(USAGE);
      return 1;
    }
    const snapshot = readRunArtifact(runId, undefined, configPath);
    if (!snapshot) {
      console.error(`Run not found: ${runId}`);
      return 1;
    }
    const formatIndex = rest.indexOf("--format");
    const format = parseReportFormat(formatIndex >= 0 ? rest[formatIndex + 1] : "markdown");
    console.log(renderReport(snapshot, format));
    return snapshot.status === "completed" ? 0 : 1;
  }
  if (command === "improve") {
    const runId = rest[0];
    if (!runId) {
      console.log(USAGE);
      return 1;
    }
    const snapshot = readRunArtifact(runId, undefined, configPath);
    if (!snapshot) {
      console.error(`Run not found: ${runId}`);
      return 1;
    }
    const suggestions = proposeFromResults(snapshot.runId, snapshot.results);
    const outIndex = rest.indexOf("--out");
    const outDir = resolve(
      outIndex >= 0 && rest[outIndex + 1] ? rest[outIndex + 1]! : defaultRegressionDir(undefined, configPath),
    );
    const drafts = writeRegressionDrafts(suggestions, outDir);
    new FileArtifactRepository(artifactRoot(undefined, configPath)).writeJson(runId, "improvement.json", suggestions);
    console.log(JSON.stringify({ suggestions, drafts }, null, 2));
    return 0;
  }
  if (command === "suggest") {
    const runId = rest[0];
    if (!runId) {
      console.log(USAGE);
      return 1;
    }
    const snapshot = readRunArtifact(runId, undefined, configPath);
    if (!snapshot) {
      console.error(`Run not found: ${runId}`);
      return 1;
    }
    const stored = snapshot.improvements;
    let suggestions: ImprovementSuggestion[] =
      Array.isArray(stored) && stored.length
        ? (stored as ImprovementSuggestion[])
        : proposeFromResults(snapshot.runId, snapshot.results);
    const acceptId = flagValue(rest, "--accept");
    const rejectId = flagValue(rest, "--reject");
    const verifyId = flagValue(rest, "--verify");
    try {
      if (acceptId) suggestions = applySuggestionDecision(suggestions, acceptId, "accepted");
      if (rejectId) suggestions = applySuggestionDecision(suggestions, rejectId, "rejected");
      if (verifyId) suggestions = applySuggestionDecision(suggestions, verifyId, "verified");
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
    new FileArtifactRepository(artifactRoot(undefined, configPath)).writeJson(runId, "improvement.json", suggestions);
    const outIndex = rest.indexOf("--out");
    const outDir = resolve(
      outIndex >= 0 && rest[outIndex + 1] ? rest[outIndex + 1]! : defaultRegressionDir(undefined, configPath),
    );
    const drafts = verifyId ? verifiedRegressionDrafts(suggestions, outDir) : [];
    console.log(JSON.stringify({ suggestions, drafts }, null, 2));
    return 0;
  }
  if (command === "candidate") {
    const baselineId = rest[0];
    if (!baselineId) {
      console.log(USAGE);
      return 1;
    }
    const baseline = readRunArtifact(baselineId, undefined, configPath);
    if (!baseline) {
      console.error(`Run not found: ${baselineId}`);
      return 1;
    }
    const options: CliOptions = {
      headless: rest.includes("--headless") || rest.includes("--artifacts-only"),
      noOpen: rest.includes("--no-open"),
      json: rest.includes("--json"),
      caseIds: [...new Set(baseline.results.map((result) => result.caseId))],
      candidateOf: baselineId,
      entry: flagValue(rest, "--entry"),
      configPath: flagValue(rest, "--config"),
    };
    const port = flagValue(rest, "--port");
    if (port) options.port = Number(port);
    const executed = await runCommandDetailed(options);
    const candidate = readRunArtifact(executed.runId, undefined, configPath) ?? executed.store.get(executed.runId);
    if (!candidate) {
      console.error("Candidate run did not persist");
      return 1;
    }
    const holdout = holdoutCaseIds([...baseline.results, ...candidate.results]);
    const comparison = compareRuns(baseline, candidate, holdout);
    new FileArtifactRepository(artifactRoot(undefined, configPath)).writeJson(executed.runId, "comparison.json", comparison);
    console.log(JSON.stringify(comparison, null, 2));
    await executed.close();
    return exitCodeForComparison(comparison, executed.exitCode);
  }
  if (command === "compare") {
    const baselineId = rest[0];
    const candidateId = rest[1];
    if (!baselineId || !candidateId) {
      console.log(USAGE);
      return 1;
    }
    const baseline = readRunArtifact(baselineId, undefined, configPath);
    const candidate = readRunArtifact(candidateId, undefined, configPath);
    if (!baseline || !candidate) {
      console.error("Both baseline and candidate runs must exist");
      return 1;
    }
    const holdout = holdoutCaseIds([...baseline.results, ...candidate.results]);
    const comparison = compareRuns(baseline, candidate, holdout);
    new FileArtifactRepository(artifactRoot(undefined, configPath)).writeJson(candidateId, "comparison.json", comparison);
    console.log(JSON.stringify(comparison, null, 2));
    return exitCodeForComparison(comparison, candidate.status === "completed" ? 0 : 1);
  }
  if (command === "replay") {
    const runId = rest[0];
    if (!runId) {
      console.log(USAGE);
      return 1;
    }
    const snapshot = readRunArtifact(runId, undefined, configPath);
    if (!snapshot) {
      console.error(`Run not found: ${runId}`);
      return 1;
    }
    const options: CliOptions = {
      headless: rest.includes("--headless") || rest.includes("--artifacts-only"),
      noOpen: rest.includes("--no-open"),
      json: rest.includes("--json"),
      caseIds: [...new Set(snapshot.results.map((result) => result.caseId))],
      replayOf: runId,
    };
    options.configPath = flagValue(rest, "--config");
    const port = flagValue(rest, "--port");
    if (port) options.port = Number(port);
    return runCommand(options);
  }
  if (command !== "run") {
    console.log(USAGE);
    return 1;
  }
  const options: CliOptions = {
    headless: rest.includes("--headless") || rest.includes("--artifacts-only"),
    noOpen: rest.includes("--no-open"),
    json: rest.includes("--json"),
  };
  options.caseId = flagValue(rest, "--case");
  options.tags = flagValues(rest, "--tag");
  options.entry = flagValue(rest, "--entry");
  options.retryOf = flagValue(rest, "--retry-of");
  try {
    options.repetitions = parseRepetitions(flagValue(rest, "--repetitions"));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  const port = flagValue(rest, "--port");
  if (port) options.port = Number(port);
  options.configPath = flagValue(rest, "--config");
  const controller = new AbortController();
  const stop = (): void => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  options.signal = options.signal ?? controller.signal;
  try {
    return await runCommand(options);
  } catch (error) {
    if (!(error instanceof CliFailure)) throw error;
    console.error(`${error.code}: ${error.message}`);
    return error.exitCode;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}
if (process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("index.js")) process.exitCode = await main();
