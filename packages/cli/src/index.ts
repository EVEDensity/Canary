#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createWebServer, FileArtifactRepository, RunStore, type RunSnapshot } from "@canary/web";
import { runConfiguredCase, mapLimit } from "@canary/runner";
import { createCoverageManifest, mergeCoverageSummaries, preparingCoverage } from "@canary/coverage";
import { renderReport, countJunitFailures } from "@canary/reporters";
import { compareRuns, holdoutCaseIds, proposeFromResults, writeRegressionDrafts, applySuggestionDecision, verifiedRegressionDrafts, type ImprovementSuggestion } from "@canary/improvement";
import { JsonlTraceStore, redactTrajectory } from "@canary/trace";
import { evaluateCoverageGates, evaluateHardGates, mergeQualityGates, exitCodeForRun } from "@canary/evaluators";
import { parseCanaryConfig, parseReportFormat, parseTestCase } from "@canary/core";
import type { CanaryConfig, CoverageSummary, TestCase } from "@canary/core";

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
}
const USAGE = "Usage: canary run [--headless] [--no-open] [--case <id>] [--tag <tag>] [--repetitions <n>] [--port <number>] [--config <path>] [--entry <path>]\n       canary runs\n       canary show <runId>\n       canary report <runId> [--format json|markdown|junit|console]\n       canary improve <runId> [--out <dir>]\n       canary suggest <runId> [--accept|--reject|--verify <id>] [--out <dir>]\n       canary candidate <baselineRunId> [--entry <path>] [--headless] [--no-open] [--config <path>]\n       canary compare <baselineRunId> <candidateRunId>\n       canary replay <runId> [--headless] [--no-open]";

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
  if (existsSync(resolve(root, "cases/regression"))) return resolve(root, "cases/regression");
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
  const improvements = repository.readJson<unknown[]>(runId, "improvement.json");
  return {
    ...run,
    ...(coverage ? { coverage } : {}),
    ...(Array.isArray(improvements) ? { improvements } : {}),
  };
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
function repetitionsFor(testCase: TestCase, fallback: number): number {
  return testCase.options?.repetitions ?? fallback;
}
function selectCases(cases: TestCase[], options: CliOptions): TestCase[] {
  let selected = cases;
  if (options.caseId) selected = selected.filter((testCase) => testCase.id === options.caseId);
  if (options.caseIds?.length) selected = selected.filter((testCase) => options.caseIds!.includes(testCase.id));
  if (options.tags?.length) selected = selected.filter((testCase) => (testCase.tags ?? []).some((tag) => options.tags!.includes(tag)));
  if (options.caseId && !selected.length) throw new Error(`No test case matched --case ${options.caseId}`);
  if (options.tags?.length && !selected.length) throw new Error(`No test case matched --tag ${options.tags.join(", ")}`);
  if (options.caseIds?.length) {
    const missing = options.caseIds.filter((id) => !selected.some((testCase) => testCase.id === id));
    if (missing.length) throw new Error(`Replay cases not found in current config: ${missing.join(", ")}`);
  }
  return selected;
}

type ReporterFormat = "json" | "markdown" | "junit" | "console";

function diskSnapshot(store: RunStore, runId: string): RunSnapshot {
  const snapshot = store.get(runId)!;
  return {
    ...snapshot,
    results: snapshot.results.map((result) => result.trajectory ? { ...result, trajectory: redactTrajectory(result.trajectory) } : result),
  };
}

function writeLiveArtifacts(artifactDir: string, snapshot: RunSnapshot): void {
  writeFileSync(resolve(artifactDir, "run.json"), JSON.stringify(snapshot, null, 2), "utf8");
  if (snapshot.coverage) writeFileSync(resolve(artifactDir, "coverage.json"), JSON.stringify(snapshot.coverage, null, 2), "utf8");
  writeFileSync(resolve(artifactDir, "trajectory.json"), JSON.stringify(snapshot.results.map((result) => ({
    caseId: result.caseId,
    repetition: result.repetition,
    trajectoryId: result.trajectoryId,
    termination: result.trajectory?.termination,
    events: result.trajectory?.events ?? [],
  })), null, 2), "utf8");
  writeFileSync(resolve(artifactDir, "evaluator.json"), JSON.stringify(snapshot.results.map((result) => ({
    caseId: result.caseId,
    repetition: result.repetition,
    execution: {
      status: result.failureCategory === "timeout" ? "timeout" : result.failureCategory === "cancelled" ? "cancelled" : result.failureCategory === "runtime_error" ? "failed" : "completed",
      durationMs: result.metrics?.latencyMs,
    },
    evaluation: { status: result.passed ? "passed" : "failed", failureCategory: result.failureCategory, assertions: result.assertions },
  })), null, 2), "utf8");
}

function writeFinalReports(artifactDir: string, snapshot: RunSnapshot, formats: ReporterFormat[], gate: ReturnType<typeof evaluateCoverageGates>, suggestions: unknown[]): string {
  const reportInput = { runId: snapshot.runId, status: snapshot.status, startedAt: snapshot.startedAt, finishedAt: snapshot.finishedAt, totalCases: snapshot.totalCases, passedCases: snapshot.passedCases, results: snapshot.results, coverage: snapshot.coverage, gate };
  let junitXml = "";
  for (const format of formats) {
    const body = renderReport(reportInput, format);
    if (format === "junit") junitXml = body;
    if (format === "console") {
      writeFileSync(resolve(artifactDir, "report.console.txt"), body, "utf8");
      continue;
    }
    const extension = format === "junit" ? "xml" : format === "markdown" ? "md" : "json";
    writeFileSync(resolve(artifactDir, `report.${extension}`), body, "utf8");
  }
  if (!junitXml) junitXml = renderReport(reportInput, "junit");
  writeFileSync(resolve(artifactDir, "gate.json"), JSON.stringify(gate, null, 2), "utf8");
  writeFileSync(resolve(artifactDir, "improvement.json"), JSON.stringify(suggestions, null, 2), "utf8");
  return junitXml;
}

async function persistExecution(input: {
  store: RunStore;
  config: CanaryConfig;
  cwd: string;
  artifactCwd?: string;
  selected: TestCase[];
  replayOf?: string;
  candidateOf?: string;
  repetitions?: number;
  signal?: AbortSignal;
  consoleReporter?: boolean;
}): Promise<{ runId: string; exitCode: number; artifactPath: string; snapshot: RunSnapshot }> {
  const fallbackReps = input.repetitions ?? input.config.runtime?.repetitions ?? 1;
  const plan = input.selected.flatMap((testCase) => {
    const total = repetitionsFor(testCase, fallbackReps);
    return Array.from({ length: total }, (_, index) => ({ testCase, repetition: index + 1, repetitionTotal: total }));
  });
  const run = input.store.create(plan.length, undefined, input.replayOf);
  if (input.candidateOf) input.store.update(run.runId, { candidateOf: input.candidateOf } as Partial<RunSnapshot>);
  const artifactDir = resolve(input.artifactCwd ?? input.cwd, ".canary/artifacts", run.runId);
  mkdirSync(artifactDir, { recursive: true });
  const trace = new JsonlTraceStore(resolve(artifactDir, "trace.jsonl"));
  input.store.setCoverage(run.runId, preparingCoverage(run.runId));
  writeLiveArtifacts(artifactDir, diskSnapshot(input.store, run.runId));
  const manifest = createCoverageManifest({ rootDir: input.cwd, include: input.config.coverage.include, exclude: input.config.coverage.exclude, features: input.config.features });
  writeFileSync(resolve(artifactDir, "coverage-manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  writeLiveArtifacts(artifactDir, diskSnapshot(input.store, run.runId));
  const summaries: CoverageSummary[] = [];
  let cancelled = false;
  const concurrency = input.config.runtime?.concurrency ?? 1;
  let writeChain = Promise.resolve();
  const withWriteLock = async <T>(fn: () => T | Promise<T>): Promise<T> => {
    const run = writeChain.then(fn, fn);
    writeChain = run.then(() => undefined, () => undefined);
    return run;
  };
  try {
    await mapLimit(plan, concurrency, async (item) => {
      if (input.signal?.aborted) { cancelled = true; return; }
      const result = await runConfiguredCase({
        config: input.config, cwd: input.cwd, runId: run.runId, manifest,
        signal: input.signal,
        repetition: item.repetitionTotal > 1 ? item.repetition : undefined,
        repetitionTotal: item.repetitionTotal > 1 ? item.repetitionTotal : undefined,
        onEvent: (event) => {
          input.store.appendEvent(run.runId, event);
          trace.append({ at: new Date().toISOString(), runId: run.runId, ...event });
        },
        onCoverage: (coverage) => {
          input.store.setCoverage(run.runId, coverage);
          if (coverage.status !== "provisional" && coverage.status !== "preparing") summaries.push(coverage);
        },
      }, item.testCase);
      await withWriteLock(() => {
        if (summaries.length) input.store.setCoverage(run.runId, mergeCoverageSummaries(run.runId, summaries, input.config.features, input.cwd));
        if (!result.passed) input.store.update(run.runId, { status: result.failureCategory === "cancelled" ? "cancelled" : "failed" });
        if (input.consoleReporter) {
          const label = item.repetitionTotal > 1 ? `${item.testCase.id}#${item.repetition}` : item.testCase.id;
          const reason = result.passed ? "" : ` · ${result.assertions.filter((assertion) => !assertion.passed).map((assertion) => assertion.message ?? assertion.id).join("; ") || result.failureCategory || "failed"}`;
          console.log(`${result.passed ? "PASS" : "FAIL"} ${label} (${result.metrics?.latencyMs ?? 0}ms)${reason}`);
        }
        writeLiveArtifacts(artifactDir, diskSnapshot(input.store, run.runId));
      });
      if (result.failureCategory === "cancelled" || input.signal?.aborted) cancelled = true;
    });
  } catch (error) {
    input.store.reportError(run.runId, error instanceof Error ? error.message : String(error));
    input.store.update(run.runId, { status: "failed" });
    writeLiveArtifacts(artifactDir, diskSnapshot(input.store, run.runId));
    throw error;
  }
  if (summaries.length) input.store.setCoverage(run.runId, mergeCoverageSummaries(run.runId, summaries, input.config.features, input.cwd));
  const final = cancelled ? input.store.finish(run.runId, "cancelled") : input.store.finish(run.runId);
  const suggestions = proposeFromResults(final.runId, final.results);
  const coverageGate = evaluateCoverageGates(final.coverage, input.config.coverage);
  const hardGate = evaluateHardGates({
    results: final.results,
    coverage: final.coverage,
    coreFeatures: input.config.features?.map((feature) => feature.id),
  });
  const gate = mergeQualityGates(coverageGate, hardGate);
  input.store.update(run.runId, { ...(!gate.passed && final.status !== "cancelled" ? { status: "failed" as const } : {}), improvements: suggestions, gate });
  const redacted = diskSnapshot(input.store, run.runId);
  const formats = (input.config.reporters?.length ? input.config.reporters : ["json", "markdown", "junit"]) as ReporterFormat[];
  const junitXml = writeFinalReports(artifactDir, redacted, formats, gate, suggestions);
  writeLiveArtifacts(artifactDir, redacted);
  const junitFailures = countJunitFailures(junitXml);
  const exitCode = exitCodeForRun({
    runFailed: redacted.status !== "completed",
    gatePassed: gate.passed && redacted.status !== "cancelled",
    junitFailures: Number.isFinite(junitFailures) ? junitFailures : 1,
  });
  if (!gate.passed) {
    const label = gate.reason === "hard_gate_failed" ? "hard-gate" : "coverage-gate";
    console.log(`${label}: fail · ${gate.reason} · ${gate.failures.map((item) => item.message).join("; ")}`);
  }
  return { runId: run.runId, exitCode, artifactPath: resolve(artifactDir, "run.json"), snapshot: redacted };
}

export async function runCommandDetailed(options: CliOptions = {}): Promise<RunCommandResult> {
  const artifactCwd = resolveCwd(options.cwd);
  const configFile = resolve(artifactCwd, options.configPath ?? "canary.config.ts");
  const cwd = dirname(configFile);
  const config = await loadConfig(configFile);
  const cases = await loadCases(config.cases, cwd, config.coverage.exclude);
  const selected = selectCases(cases, options);
  const store = new RunStore();
  const persistOptions = {
    store, config: options.entry ? { ...config, agent: { ...config.agent, entry: options.entry } } : config,
    cwd, artifactCwd, selected, replayOf: options.replayOf, candidateOf: options.candidateOf, repetitions: options.repetitions, signal: options.signal,
    consoleReporter: Boolean(config.reporters?.includes("console")),
  };
  const web = createWebServer(store, config.web?.host ?? "127.0.0.1", options.port ?? config.web?.port ?? 0, resolve(artifactCwd, ".canary/artifacts"), {
    onReplay: async (sourceId, request) => {
      const source = store.get(sourceId);
      if (!source) throw new Error(`Run not found: ${sourceId}`);
      const wanted = request.caseId ? [request.caseId] : [...new Set(source.results.map((result) => result.caseId))];
      const replayCases = cases.filter((testCase) => wanted.includes(testCase.id));
      if (!replayCases.length) throw new Error("No cases to replay");
      const replayed = await persistExecution({ ...persistOptions, selected: replayCases, replayOf: sourceId });
      return { replayRunId: replayed.runId };
    },
  });
  const listening = await web.listen();
  const executed = await persistExecution(persistOptions);
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
  if (command === "suggest") {
    const runId = rest[0];
    if (!runId) { console.log(USAGE); return 1; }
    const snapshot = readRunArtifact(runId);
    if (!snapshot) { console.error(`Run not found: ${runId}`); return 1; }
    const stored = snapshot.improvements;
    let suggestions: ImprovementSuggestion[] = Array.isArray(stored) && stored.length
      ? stored as ImprovementSuggestion[]
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
    writeFileSync(resolve(artifactRoot(), runId, "improvement.json"), JSON.stringify(suggestions, null, 2), "utf8");
    const outIndex = rest.indexOf("--out");
    const outDir = resolve(outIndex >= 0 && rest[outIndex + 1] ? rest[outIndex + 1]! : defaultRegressionDir());
    const drafts = verifyId ? verifiedRegressionDrafts(suggestions, outDir) : [];
    console.log(JSON.stringify({ suggestions, drafts }, null, 2));
    return 0;
  }
  if (command === "candidate") {
    const baselineId = rest[0];
    if (!baselineId) { console.log(USAGE); return 1; }
    const baseline = readRunArtifact(baselineId);
    if (!baseline) { console.error(`Run not found: ${baselineId}`); return 1; }
    const options: CliOptions = {
      headless: rest.includes("--headless"),
      noOpen: rest.includes("--no-open"),
      caseIds: [...new Set(baseline.results.map((result) => result.caseId))],
      candidateOf: baselineId,
      entry: flagValue(rest, "--entry"),
      configPath: flagValue(rest, "--config"),
    };
    const port = flagValue(rest, "--port");
    if (port) options.port = Number(port);
    const executed = await runCommandDetailed(options);
    const candidate = readRunArtifact(executed.runId) ?? executed.store.get(executed.runId);
    if (!candidate) { console.error("Candidate run did not persist"); return 1; }
    const holdout = holdoutCaseIds([...baseline.results, ...candidate.results]);
    const comparison = compareRuns(baseline, candidate, holdout);
    writeFileSync(resolve(artifactRoot(), executed.runId, "comparison.json"), JSON.stringify(comparison, null, 2), "utf8");
    console.log(JSON.stringify(comparison, null, 2));
    await executed.close();
    return comparison.verdict === "reject" ? 1 : 0;
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
    writeFileSync(resolve(artifactRoot(), candidateId, "comparison.json"), JSON.stringify(comparison, null, 2), "utf8");
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
      caseIds: [...new Set(snapshot.results.map((result) => result.caseId))],
      replayOf: runId,
    };
    options.configPath = flagValue(rest, "--config");
    const port = flagValue(rest, "--port");
    if (port) options.port = Number(port);
    return runCommand(options);
  }
  if (command !== "run") { console.log(USAGE); return 1; }
  const options: CliOptions = { headless: rest.includes("--headless"), noOpen: rest.includes("--no-open") };
  options.caseId = flagValue(rest, "--case");
  options.tags = flagValues(rest, "--tag");
  options.entry = flagValue(rest, "--entry");
  try { options.repetitions = parseRepetitions(flagValue(rest, "--repetitions")); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); return 1; }
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
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}
if (process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("index.js")) process.exitCode = await main();
