import { mkdirSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createWebServer, FileArtifactRepository, RunStore, type RunSnapshot } from "@canary/web";
import { runConfiguredCase } from "@canary/runner";
import { createCoverageManifest, mergeCoverageSummaries } from "@canary/coverage";
import type { CanaryConfig, CoverageSummary, TestCase } from "@canary/core";

export interface CliOptions { configPath?: string; cwd?: string; headless?: boolean; noOpen?: boolean; port?: number; caseId?: string }
const USAGE = "Usage: canary run [--headless] [--no-open] [--case <id>] [--port <number>] [--config <path>]\n       canary runs\n       canary show <runId>";

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
  return defaultExport(await importModule(configPath)) as CanaryConfig;
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
      if (!candidate || typeof candidate !== "object" || typeof (candidate as TestCase).id !== "string" || typeof (candidate as TestCase).input === "undefined") {
        throw new Error(`Invalid TestCase schema in ${file}`);
      }
      const testCase = candidate as TestCase;
      if (ids.has(testCase.id)) throw new Error(`Duplicate test case id: ${testCase.id}`);
      ids.add(testCase.id);
      cases.push(testCase);
    }
  }
  return cases;
}

function resolveCwd(cwd?: string): string {
  return resolve(cwd ?? process.env.INIT_CWD ?? process.cwd());
}
export function artifactRoot(cwd?: string): string {
  return resolve(resolveCwd(cwd), ".canary/artifacts");
}
export function listRunArtifacts(cwd?: string): RunSnapshot[] {
  return new FileArtifactRepository(artifactRoot(cwd)).listRuns();
}
export function readRunArtifact(runId: string, cwd?: string): RunSnapshot | undefined {
  const repository = new FileArtifactRepository(artifactRoot(cwd));
  const run = repository.readRun(runId);
  if (!run) return undefined;
  const coverage = run.coverage ?? repository.readCoverage(runId);
  return coverage ? { ...run, coverage } : run;
}

function openBrowser(url: string): void {
  if (process.platform === "win32") void import("node:child_process").then(({ spawn }) => spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }));
  else if (process.platform === "darwin") void import("node:child_process").then(({ spawn }) => spawn("open", [url], { detached: true, stdio: "ignore" }));
  else void import("node:child_process").then(({ spawn }) => spawn("xdg-open", [url], { detached: true, stdio: "ignore" }));
}

function formatCoverage(coverage?: CoverageSummary): string {
  if (!coverage) return "unavailable";
  const part = (key: "lines" | "functions" | "branches" | "statements") => `${key} ${coverage[key].covered}/${coverage[key].total} (${coverage[key].pct}%)`;
  return `${coverage.status} · ${part("lines")} · ${part("functions")} · ${part("branches")} · ${part("statements")}`;
}

export function printRunSummary(run: RunSnapshot, extras: { artifactPath: string; uiUrl?: string; exitCode: number }): void {
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
  if (!runs.length) { console.log("No runs found."); return; }
  for (const run of runs) {
    console.log(`${run.runId}\t${run.status}\t${run.passedCases}/${run.totalCases}\t${run.startedAt}`);
  }
}

export interface RunCommandResult { exitCode: number; runId: string; artifactPath: string; uiUrl: string; store: RunStore; close: () => Promise<void> }
export async function runCommandDetailed(options: CliOptions = {}): Promise<RunCommandResult> {
  const cwd = resolveCwd(options.cwd);
  const config = await loadConfig(resolve(cwd, options.configPath ?? "canary.config.ts"));
  const cases = await loadCases(config.cases, cwd, config.coverage.exclude);
  const selected = options.caseId ? cases.filter((testCase) => testCase.id === options.caseId) : cases;
  if (options.caseId && !selected.length) throw new Error(`No test case matched --case ${options.caseId}`);
  const store = new RunStore();
  const run = store.create(selected.length);
  const artifactDir = resolve(cwd, ".canary/artifacts", run.runId);
  mkdirSync(artifactDir, { recursive: true });
  const manifest = createCoverageManifest({ rootDir: cwd, include: config.coverage.include, exclude: config.coverage.exclude, features: config.features });
  writeFileSync(resolve(artifactDir, "coverage-manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  const web = createWebServer(store, config.web?.host ?? "127.0.0.1", options.port ?? config.web?.port ?? 0, resolve(cwd, ".canary/artifacts"));
  const listening = await web.listen();
  const url = `${listening.url}/?runId=${encodeURIComponent(run.runId)}`;
  console.log(`canary UI: ${url}`);
  if (!options.headless && !options.noOpen && config.web?.open !== false) openBrowser(url);
  const summaries: CoverageSummary[] = [];
  for (const testCase of selected) {
    const result = await runConfiguredCase({
      config, cwd, runId: run.runId, manifest,
      onEvent: (event) => store.appendEvent(run.runId, event),
      onCoverage: (coverage) => {
        store.setCoverage(run.runId, coverage);
        if (coverage.status !== "provisional") summaries.push(coverage);
      },
    }, testCase);
    if (summaries.length) store.setCoverage(run.runId, mergeCoverageSummaries(run.runId, summaries, config.features, cwd));
    if (!result.passed) store.update(run.runId, { status: "failed" });
  }
  const final = store.finish(run.runId);
  writeFileSync(resolve(artifactDir, "run.json"), JSON.stringify(final, null, 2), "utf8");
  if (final.coverage) writeFileSync(resolve(artifactDir, "coverage.json"), JSON.stringify(final.coverage, null, 2), "utf8");
  writeFileSync(resolve(artifactDir, "trajectory.json"), JSON.stringify(final.results.map((result) => ({
    caseId: result.caseId,
    trajectoryId: result.trajectoryId,
    termination: result.trajectory?.termination,
    events: result.trajectory?.events ?? [],
  })), null, 2), "utf8");
  writeFileSync(resolve(artifactDir, "evaluator.json"), JSON.stringify(final.results.map((result) => ({
    caseId: result.caseId,
    execution: {
      status: result.failureCategory === "timeout" ? "timeout" : result.failureCategory === "cancelled" ? "cancelled" : result.failureCategory === "runtime_error" ? "failed" : "completed",
      durationMs: result.metrics?.latencyMs,
    },
    evaluation: { status: result.passed ? "passed" : "failed", failureCategory: result.failureCategory, assertions: result.assertions },
  })), null, 2), "utf8");
  const exitCode = final.status === "completed" ? 0 : 1;
  printRunSummary(final, { artifactPath: resolve(artifactDir, "run.json"), uiUrl: url, exitCode });
  let webClosed = false;
  const close = async (): Promise<void> => {
    if (webClosed || !web.server.listening) { webClosed = true; return; }
    await new Promise<void>((resolveClose, rejectClose) => web.server.close((error) => error ? rejectClose(error) : resolveClose()));
    webClosed = true;
  };
  if (options.headless) await close();
  return { exitCode, runId: run.runId, artifactPath: resolve(artifactDir, "run.json"), uiUrl: url, store, close };
}
export async function runCommand(options: CliOptions = {}): Promise<number> {
  return (await runCommandDetailed(options)).exitCode;
}

function parseArgv(argv: string[]): { command: string; rest: string[] } {
  const args = argv.filter((item) => item !== "--");
  const command = args[0] && !args[0].startsWith("-") ? args[0] : "run";
  return { command, rest: command === args[0] ? args.slice(1) : args };
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const { command, rest } = parseArgv(argv);
  if (command === "help") { console.log(USAGE); return 0; }
  if (command === "runs") {
    printRunList(listRunArtifacts());
    return 0;
  }
  if (command === "show") {
    const runId = rest[0];
    if (!runId) { console.log(USAGE); return 1; }
    const snapshot = readRunArtifact(runId);
    if (!snapshot) { console.error(`Run not found: ${runId}`); return 1; }
    printRunSummary(snapshot, { artifactPath: resolve(artifactRoot(), runId, "run.json"), exitCode: snapshot.status === "completed" ? 0 : 1 });
    return snapshot.status === "completed" ? 0 : 1;
  }
  if (command !== "run") { console.log(USAGE); return 1; }
  const options: CliOptions = { headless: rest.includes("--headless"), noOpen: rest.includes("--no-open") };
  const caseIndex = rest.indexOf("--case");
  if (caseIndex >= 0) options.caseId = rest[caseIndex + 1];
  const portIndex = rest.indexOf("--port");
  if (portIndex >= 0) options.port = Number(rest[portIndex + 1]);
  const configIndex = rest.indexOf("--config");
  if (configIndex >= 0) options.configPath = rest[configIndex + 1];
  return runCommand(options);
}
if (process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("index.js")) process.exitCode = await main();
