import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createWebServer, FileArtifactRepository, RunStore, type RunSnapshot } from "@canary/web";
import { runConfiguredCase } from "@canary/runner";
import { createCoverageManifest, mergeCoverageSummaries } from "@canary/coverage";
import { renderReport, countJunitFailures } from "@canary/reporters";
import { compareRuns, holdoutCaseIds, proposeFromResults, writeRegressionDrafts } from "@canary/improvement";
import { redactTrajectory } from "@canary/trace";
import { evaluateCoverageGates, exitCodeForRun } from "@canary/evaluators";
import { parseCanaryConfig, parseReportFormat, parseTestCase } from "@canary/core";
import type { CanaryConfig, CoverageSummary, TestCase } from "@canary/core";

export interface CliOptions { configPath?: string; cwd?: string; headless?: boolean; noOpen?: boolean; port?: number; caseId?: string; caseIds?: string[]; replayOf?: string }
const USAGE = "Usage: canary run [--headless] [--no-open] [--case <id>] [--port <number>] [--config <path>]\n       canary runs\n       canary show <runId>\n       canary report <runId> [--format json|markdown|junit]\n       canary improve <runId> [--out <dir>]\n       canary compare <baselineRunId> <candidateRunId>\n       canary replay <runId> [--headless] [--no-open]";

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

function resolveCwd(cwd?: string): string {
  return resolve(cwd ?? process.env.INIT_CWD ?? process.cwd());
}
export function artifactRoot(cwd?: string): string {
  return resolve(resolveCwd(cwd), ".canary/artifacts");
}
export function defaultRegressionDir(cwd?: string): string {
  const root = resolveCwd(cwd);
  if (existsSync(resolve(root, "examples/local-agent/cases"))) return resolve(root, "examples/local-agent/cases/regression");
  return resolve(root, "cases/regression");
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
async function persistExecution(input: {
  store: RunStore;
  config: CanaryConfig;
  cwd: string;
  selected: TestCase[];
  replayOf?: string;
}): Promise<{ runId: string; exitCode: number; artifactPath: string; snapshot: RunSnapshot }> {
  const run = input.store.create(input.selected.length, undefined, input.replayOf);
  const artifactDir = resolve(input.cwd, ".canary/artifacts", run.runId);
  mkdirSync(artifactDir, { recursive: true });
  const manifest = createCoverageManifest({ rootDir: input.cwd, include: input.config.coverage.include, exclude: input.config.coverage.exclude, features: input.config.features });
  writeFileSync(resolve(artifactDir, "coverage-manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  const summaries: CoverageSummary[] = [];
  for (const testCase of input.selected) {
    const result = await runConfiguredCase({
      config: input.config, cwd: input.cwd, runId: run.runId, manifest,
      onEvent: (event) => input.store.appendEvent(run.runId, event),
      onCoverage: (coverage) => {
        input.store.setCoverage(run.runId, coverage);
        if (coverage.status !== "provisional") summaries.push(coverage);
      },
    }, testCase);
    if (summaries.length) input.store.setCoverage(run.runId, mergeCoverageSummaries(run.runId, summaries, input.config.features, input.cwd));
    if (!result.passed) input.store.update(run.runId, { status: "failed" });
  }
  const final = input.store.finish(run.runId);
  const suggestions = proposeFromResults(final.runId, final.results);
  const gate = evaluateCoverageGates(final.coverage, input.config.coverage);
  input.store.update(run.runId, { ...(!gate.passed ? { status: "failed" as const } : {}), improvements: suggestions, gate });
  const redacted = {
    ...input.store.get(run.runId)!,
    results: (input.store.get(run.runId)?.results ?? final.results).map((result) => result.trajectory ? { ...result, trajectory: redactTrajectory(result.trajectory) } : result),
  };
  writeFileSync(resolve(artifactDir, "run.json"), JSON.stringify(redacted, null, 2), "utf8");
  if (redacted.coverage) writeFileSync(resolve(artifactDir, "coverage.json"), JSON.stringify(redacted.coverage, null, 2), "utf8");
  writeFileSync(resolve(artifactDir, "trajectory.json"), JSON.stringify(redacted.results.map((result) => ({
    caseId: result.caseId,
    trajectoryId: result.trajectoryId,
    termination: result.trajectory?.termination,
    events: result.trajectory?.events ?? [],
  })), null, 2), "utf8");
  writeFileSync(resolve(artifactDir, "evaluator.json"), JSON.stringify(redacted.results.map((result) => ({
    caseId: result.caseId,
    execution: {
      status: result.failureCategory === "timeout" ? "timeout" : result.failureCategory === "cancelled" ? "cancelled" : result.failureCategory === "runtime_error" ? "failed" : "completed",
      durationMs: result.metrics?.latencyMs,
    },
    evaluation: { status: result.passed ? "passed" : "failed", failureCategory: result.failureCategory, assertions: result.assertions },
  })), null, 2), "utf8");
  writeFileSync(resolve(artifactDir, "gate.json"), JSON.stringify(gate, null, 2), "utf8");
  const reportInput = { runId: redacted.runId, status: redacted.status, startedAt: redacted.startedAt, finishedAt: redacted.finishedAt, totalCases: redacted.totalCases, passedCases: redacted.passedCases, results: redacted.results, coverage: redacted.coverage, gate };
  const formats = input.config.reporters?.length ? input.config.reporters : ["json", "markdown", "junit"] as Array<"json" | "markdown" | "junit">;
  let junitXml = "";
  for (const format of formats) {
    const extension = format === "junit" ? "xml" : format === "markdown" ? "md" : "json";
    const body = renderReport(reportInput, format);
    if (format === "junit") junitXml = body;
    writeFileSync(resolve(artifactDir, `report.${extension}`), body, "utf8");
  }
  if (!junitXml) junitXml = renderReport(reportInput, "junit");
  writeFileSync(resolve(artifactDir, "improvement.json"), JSON.stringify(suggestions, null, 2), "utf8");
  const junitFailures = countJunitFailures(junitXml);
  const exitCode = exitCodeForRun({
    runFailed: redacted.status !== "completed",
    gatePassed: gate.passed,
    junitFailures: Number.isFinite(junitFailures) ? junitFailures : 1,
  });
  if (!gate.passed) console.log(`coverage-gate: fail · ${gate.reason} · ${gate.failures.map((item) => item.message).join("; ")}`);
  return { runId: run.runId, exitCode, artifactPath: resolve(artifactDir, "run.json"), snapshot: redacted };
}

export async function runCommandDetailed(options: CliOptions = {}): Promise<RunCommandResult> {
  const cwd = resolveCwd(options.cwd);
  const config = await loadConfig(resolve(cwd, options.configPath ?? "canary.config.ts"));
  const cases = await loadCases(config.cases, cwd, config.coverage.exclude);
  const selected = options.caseId
    ? cases.filter((testCase) => testCase.id === options.caseId)
    : options.caseIds
      ? cases.filter((testCase) => options.caseIds!.includes(testCase.id))
      : cases;
  if (options.caseId && !selected.length) throw new Error(`No test case matched --case ${options.caseId}`);
  if (options.caseIds?.length) {
    const missing = options.caseIds.filter((id) => !selected.some((testCase) => testCase.id === id));
    if (missing.length) throw new Error(`Replay cases not found in current config: ${missing.join(", ")}`);
  }
  const store = new RunStore();
  const web = createWebServer(store, config.web?.host ?? "127.0.0.1", options.port ?? config.web?.port ?? 0, resolve(cwd, ".canary/artifacts"), {
    onReplay: async (sourceId, request) => {
      const source = store.get(sourceId);
      if (!source) throw new Error(`Run not found: ${sourceId}`);
      const wanted = request.caseId ? [request.caseId] : source.results.map((result) => result.caseId);
      const replayCases = cases.filter((testCase) => wanted.includes(testCase.id));
      if (!replayCases.length) throw new Error("No cases to replay");
      const replayed = await persistExecution({ store, config, cwd, selected: replayCases, replayOf: sourceId });
      return { replayRunId: replayed.runId };
    },
  });
  const listening = await web.listen();
  const executed = await persistExecution({ store, config, cwd, selected, replayOf: options.replayOf });
  const url = `${listening.url}/?runId=${encodeURIComponent(executed.runId)}`;
  console.log(`canary UI: ${url}`);
  if (!options.headless && !options.noOpen && config.web?.open !== false) openBrowser(url);
  printRunSummary(executed.snapshot, { artifactPath: executed.artifactPath, uiUrl: url, exitCode: executed.exitCode });
  let webClosed = false;
  const close = async (): Promise<void> => {
    if (webClosed || !web.server.listening) { webClosed = true; return; }
    await new Promise<void>((resolveClose, rejectClose) => web.server.close((error) => error ? rejectClose(error) : resolveClose()));
    webClosed = true;
  };
  if (options.headless) await close();
  return { exitCode: executed.exitCode, runId: executed.runId, artifactPath: executed.artifactPath, uiUrl: url, store, close };
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
  if (command === "report") {
    const runId = rest[0];
    if (!runId) { console.log(USAGE); return 1; }
    const snapshot = readRunArtifact(runId);
    if (!snapshot) { console.error(`Run not found: ${runId}`); return 1; }
    const formatIndex = rest.indexOf("--format");
    const format = parseReportFormat(formatIndex >= 0 ? rest[formatIndex + 1] : "markdown");
    console.log(renderReport({ runId: snapshot.runId, status: snapshot.status, startedAt: snapshot.startedAt, finishedAt: snapshot.finishedAt, totalCases: snapshot.totalCases, passedCases: snapshot.passedCases, results: snapshot.results, coverage: snapshot.coverage }, format));
    return snapshot.status === "completed" ? 0 : 1;
  }
  if (command === "improve") {
    const runId = rest[0];
    if (!runId) { console.log(USAGE); return 1; }
    const snapshot = readRunArtifact(runId);
    if (!snapshot) { console.error(`Run not found: ${runId}`); return 1; }
    const suggestions = proposeFromResults(snapshot.runId, snapshot.results);
    const outIndex = rest.indexOf("--out");
    const outDir = resolve(outIndex >= 0 && rest[outIndex + 1] ? rest[outIndex + 1]! : defaultRegressionDir());
    const drafts = writeRegressionDrafts(suggestions, outDir);
    writeFileSync(resolve(artifactRoot(), runId, "improvement.json"), JSON.stringify(suggestions, null, 2), "utf8");
    console.log(JSON.stringify({ suggestions, drafts }, null, 2));
    return 0;
  }
  if (command === "compare") {
    const baselineId = rest[0];
    const candidateId = rest[1];
    if (!baselineId || !candidateId) { console.log(USAGE); return 1; }
    const baseline = readRunArtifact(baselineId);
    const candidate = readRunArtifact(candidateId);
    if (!baseline || !candidate) { console.error("Both baseline and candidate runs must exist"); return 1; }
    const holdout = holdoutCaseIds([...baseline.results, ...candidate.results]);
    const comparison = compareRuns(baseline, candidate, holdout);
    console.log(JSON.stringify(comparison, null, 2));
    return comparison.verdict === "reject" ? 1 : 0;
  }
  if (command === "replay") {
    const runId = rest[0];
    if (!runId) { console.log(USAGE); return 1; }
    const snapshot = readRunArtifact(runId);
    if (!snapshot) { console.error(`Run not found: ${runId}`); return 1; }
    const options: CliOptions = {
      headless: rest.includes("--headless"),
      noOpen: rest.includes("--no-open"),
      caseIds: snapshot.results.map((result) => result.caseId),
      replayOf: runId,
    };
    const configIndex = rest.indexOf("--config");
    if (configIndex >= 0) options.configPath = rest[configIndex + 1];
    const portIndex = rest.indexOf("--port");
    if (portIndex >= 0) options.port = Number(rest[portIndex + 1]);
    return runCommand(options);
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
