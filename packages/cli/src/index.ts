import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createWebServer, RunStore } from "@canary/web";
import { runExecution } from "@canary/runner";
import type { CanaryConfig, TestCase } from "@canary/core";

export interface CliOptions { configPath?: string; cwd?: string; headless?: boolean; noOpen?: boolean; port?: number; caseId?: string }

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
  if (value && typeof value === "object" && "default" in value) return (value as Record<string, unknown>).default;
  return value;
}

async function loadConfig(configPath: string): Promise<CanaryConfig> {
  return defaultExport(await importModule(configPath)) as CanaryConfig;
}

async function loadCases(pattern: string, cwd: string): Promise<TestCase[]> {
  const hasGlob = /[*?[]/.test(pattern);
  const files: string[] = [];
  if (!hasGlob) {
    files.push(resolve(cwd, pattern));
  } else {
    const wildcard = pattern.search(/[*?[]/);
    const base = pattern.slice(0, wildcard);
    const directory = resolve(cwd, base.endsWith("/") || base.endsWith("\\") ? base : dirname(base));
    if (!existsSync(directory)) return [];
    const entries = await (await import("node:fs/promises")).readdir(directory, { recursive: true });
    for (const entry of entries) {
      if (typeof entry === "string" && /\.[cm]?[jt]s$/.test(entry) && !entry.endsWith(".d.ts")) files.push(resolve(directory, entry));
    }
  }
  const cases: TestCase[] = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    const value = defaultExport(await importModule(file));
    cases.push(...(Array.isArray(value) ? value : [value]) as TestCase[]);
  }
  return cases;
}

function openBrowser(url: string): void {
  if (process.platform === "win32") void import("node:child_process").then(({ spawn }) => spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }));
  else if (process.platform === "darwin") void import("node:child_process").then(({ spawn }) => spawn("open", [url], { detached: true, stdio: "ignore" }));
  else void import("node:child_process").then(({ spawn }) => spawn("xdg-open", [url], { detached: true, stdio: "ignore" }));
}

export interface RunCommandResult { exitCode: number; runId: string; artifactPath: string; uiUrl: string; store: RunStore; close: () => Promise<void> }

export async function runCommandDetailed(options: CliOptions = {}): Promise<RunCommandResult> {
  const cwd = resolve(options.cwd ?? process.env.INIT_CWD ?? process.cwd());
  const configPath = resolve(cwd, options.configPath ?? "canary.config.ts");
  const config = await loadConfig(configPath);
  const cases = await loadCases(config.cases, cwd);
  const selected = options.caseId ? cases.filter((testCase) => testCase.id === options.caseId) : cases;
  const store = new RunStore();
  const run = store.create(selected.length);
  const web = createWebServer(store, config.web?.host ?? "127.0.0.1", options.port ?? config.web?.port ?? 0);
  const listening = await web.listen();
  const url = `${listening.url}/?runId=${encodeURIComponent(run.runId)}`;
  console.log(`canary UI: ${url}`);
  if (!options.headless && !options.noOpen && config.web?.open !== false) openBrowser(url);
  const coverageInclude = config.coverage.include;
  for (const testCase of selected) {
    const result = await runExecution({
      cwd,
      entry: config.agent.entry,
      exportName: config.agent.export,
      input: testCase.input,
      runId: run.runId,
      caseId: testCase.id,
      timeoutMs: 60_000,
      coverage: { rootDir: cwd, include: coverageInclude, exclude: config.coverage.exclude, featureChains: {} },
      onEvent: (event) => store.appendEvent(run.runId, event),
      onCoverage: (coverage) => store.setCoverage(run.runId, coverage),
    });
    if (!result.passed) store.update(run.runId, { status: "failed" });
  }
  const final = store.finish(run.runId);
  mkdirSync(resolve(cwd, ".canary/artifacts", run.runId), { recursive: true });
  writeFileSync(resolve(cwd, ".canary/artifacts", run.runId, "run.json"), JSON.stringify(final, null, 2), "utf8");
  let webClosed = false;
  const close = async (): Promise<void> => {
    if (webClosed || !web.server.listening) { webClosed = true; return; }
    await new Promise<void>((resolveClose, rejectClose) => web.server.close((error) => error ? rejectClose(error) : resolveClose()));
    webClosed = true;
  };
  if (options.headless) await close();
  return { exitCode: final.status === "completed" ? 0 : 1, runId: run.runId, artifactPath: resolve(cwd, ".canary/artifacts", run.runId, "run.json"), uiUrl: url, store, close };
}

export async function runCommand(options: CliOptions = {}): Promise<number> {
  return (await runCommandDetailed(options)).exitCode;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const command = argv[0] ?? "help";
  if (command !== "run") { console.log("Usage: canary run [--headless] [--no-open] [--case <id>] [--port <number>]"); return command === "help" ? 0 : 1; }
  const options: CliOptions = { headless: argv.includes("--headless"), noOpen: argv.includes("--no-open") };
  const caseIndex = argv.indexOf("--case"); if (caseIndex >= 0) options.caseId = argv[caseIndex + 1];
  const portIndex = argv.indexOf("--port"); if (portIndex >= 0) options.port = Number(argv[portIndex + 1]);
  const configIndex = argv.indexOf("--config"); if (configIndex >= 0) options.configPath = argv[configIndex + 1];
  return runCommand(options);
}

if (process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("index.js")) process.exitCode = await main();





