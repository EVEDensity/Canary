import type { CoverageMetric, CoverageSummary } from "@canary/core";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { Session } from "node:inspector/promises";

export interface CoverageSession {
  executionId: string;
  startedAt: string;
  status: "running" | "final" | "partial" | "unavailable";
}

export interface CoverageSourceConfig {
  rootDir?: string;
  include: string[];
  exclude?: string[];
  sourceText?: (filePath: string) => string;
  featureChains?: Record<string, { name?: string; files: string[]; lines?: Array<{ start: number; end: number }> }>;
}

export interface CoverageOptions extends CoverageSourceConfig {
  runId: string;
  executionId: string;
  sampleIntervalMs?: number;
  sourceText?: (filePath: string) => string;
  onUpdate?: (summary: CoverageSummary) => void;
}

export interface CoverageRange {
  startOffset: number;
  endOffset: number;
  count: number;
}

export interface CoverageFunction {
  functionName: string;
  ranges: CoverageRange[];
}

export interface CoverageScript {
  url: string;
  functions: CoverageFunction[];
}

interface FileUnits {
  lines: number[];
  functions: number[];
  branches: number[];
  statements: number[];
  branchesByLine: Map<number, number>;
}

const INSPECTOR_COVERAGE = "Profiler.takePreciseCoverage";

export function emptyMetric(): CoverageMetric {
  return { covered: 0, total: 0, pct: 0 };
}

export function metric(covered: number, total: number): CoverageMetric {
  return { covered, total, pct: total === 0 ? 0 : Number(((covered / total) * 100).toFixed(2)) };
}

export function createCoverageSession(executionId: string): CoverageSession {
  return { executionId, startedAt: new Date().toISOString(), status: "running" };
}

export function emptyCoverage(runId: string, sourceHash = "unknown"): CoverageSummary {
  return { runId, sourceHash, status: "unavailable", lines: emptyMetric(), statements: emptyMetric(), functions: emptyMetric(), branches: emptyMetric(), featureChains: [] };
}

function normalizeFile(url: string, rootDir: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("file://")) {
    try { return resolve(new URL(url)); } catch { return undefined; }
  }
  if (url.startsWith("node:") || url.startsWith("internal:")) return undefined;
  return resolve(rootDir, url);
}

function matches(filePath: string, patterns: string[], rootDir: string): boolean {
  const value = relative(rootDir, filePath).replaceAll("\\", "/");
  return patterns.some((pattern) => {
    const normalized = pattern.replaceAll("\\", "/").replace(/^\.\//, "");
    if (normalized.includes("**")) {
      const [prefix, suffix = ""] = normalized.split("**");
      return value.startsWith(prefix ?? "") && value.endsWith(suffix.replace(/^\//, ""));
    }
    return value === normalized || value.endsWith(`/${normalized}`);
  });
}

function lineAtOffset(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i += 1) if (source[i] === "\n") line += 1;
  return line;
}

function sourceHash(files: string[], getSource: (filePath: string) => string): string {
  const hash = createHash("sha256");
  for (const filePath of files.sort()) hash.update(filePath).update("\0").update(getSource(filePath));
  return hash.digest("hex").slice(0, 16);
}

function buildFileUnits(filePath: string, source: string): FileUnits {
  const lines = source.split(/\r?\n/).map((_, index) => index + 1).filter((line) => source.split(/\r?\n/)[line - 1]?.trim() !== "");
  const functionLines = [...source.matchAll(/(?:function\s+\w+|(?:const|let)\s+\w+\s*=\s*(?:async\s*)?\(?[^=]*\)?\s*=>)/g)].map((m) => lineAtOffset(source, m.index ?? 0));
  const branchLines = [...source.matchAll(/\bif\s*\(|\?|\belse\b|\bswitch\s*\(/g)].map((m) => lineAtOffset(source, m.index ?? 0));
  const statementLines = lines;
  return { lines, functions: functionLines, branches: branchLines, statements: statementLines, branchesByLine: new Map(branchLines.map((line) => [line, 0])) };
}

function hitLines(script: CoverageScript, source: string): Set<number> {
  const hit = new Set<number>();
  for (const fn of script.functions) for (const range of fn.ranges) if (range.count > 0) hit.add(lineAtOffset(source, range.startOffset));
  return hit;
}

function toFileCoverage(script: CoverageScript, filePath: string, getSource: (filePath: string) => string): { units: FileUnits; hit: Set<number> } {
  const source = getSource(filePath);
  const units = buildFileUnits(filePath, source);
  return { units, hit: hitLines(script, source) };
}

export function summarizeCoverage(runId: string, scripts: CoverageScript[], options: CoverageSourceConfig): CoverageSummary {
  const rootDir = resolve(options.rootDir ?? process.cwd());
  const getSource = options.sourceText ?? ((filePath: string) => existsSync(filePath) ? readFileSync(filePath, "utf8") : "");
  const observed = scripts.map((script) => normalizeFile(script.url, rootDir)).filter((file): file is string => Boolean(file));
  const configured = options.include.flatMap((pattern) => pattern.includes("*") ? observed.filter((file) => matches(file, [pattern], rootDir)) : [resolve(rootDir, pattern)]);`n  const included = [...new Set([...observed, ...configured])].filter((file) => matches(file, options.include, rootDir) && !matches(file, options.exclude ?? [], rootDir));
  const byPath = new Map<string, CoverageScript>();`n  for (const filePath of included) byPath.set(filePath, scripts.find((script) => normalizeFile(script.url, rootDir) === filePath) ?? { url: filePath, functions: [] });
  const fileCoverage = [...byPath.entries()].map(([filePath, script]) => toFileCoverage(script, filePath, getSource));
  const totals = { lines: [0, 0], statements: [0, 0], functions: [0, 0], branches: [0, 0] };
  const featureChains = Object.entries(options.featureChains ?? {}).map(([featureId, feature]) => {
    const paths = [...byPath.keys()].filter((filePath) => matches(filePath, feature.files, rootDir));
    let total = 0; let covered = 0;
    for (const filePath of paths) { const item = toFileCoverage(byPath.get(filePath)!, filePath, getSource); const allowed = feature.lines ? item.units.lines.filter((line) => feature.lines!.some((range) => line >= range.start && line <= range.end)) : item.units.lines; total += allowed.length; covered += allowed.filter((line) => item.hit.has(line)).length; }
    return { featureId, name: feature.name ?? featureId, coverage: metric(covered, total) };
  });
  for (const { units, hit } of fileCoverage) {
    for (const key of ["lines", "statements", "functions", "branches"] as const) { const unitLines = units[key]; totals[key][1] += unitLines.length; totals[key][0] += unitLines.filter((line) => hit.has(line)).length; }
  }
  return {
    runId,
    sourceHash: sourceHash([...byPath.keys()], getSource),
    status: "final",
    lines: metric(totals.lines[0], totals.lines[1]),
    statements: metric(totals.statements[0], totals.statements[1]),
    functions: metric(totals.functions[0], totals.functions[1]),
    branches: metric(totals.branches[0], totals.branches[1]),
    featureChains,
  };
}

export class V8CoverageCollector {
  private readonly session = new Session();
  private timer?: NodeJS.Timeout;
  private started = false;
  private latest: CoverageScript[] = [];
  private readonly options: CoverageOptions;

  constructor(options: CoverageOptions) { this.options = options; }

  async start(): Promise<void> {
    if (this.started) return;
    await this.session.connect();
    await this.session.post("Profiler.enable");
    await this.session.post("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
    this.started = true;
    this.timer = setInterval(() => { void this.sample(); }, this.options.sampleIntervalMs ?? 1000);
  }

  private async sample(): Promise<CoverageSummary | undefined> {
    if (!this.started) return undefined;
    const response = await this.session.post(INSPECTOR_COVERAGE) as { result: CoverageScript[] };
    this.latest = response.result;
    const summary = summarizeCoverage(this.options.runId, this.latest, this.options);
    summary.status = "provisional";
    this.options.onUpdate?.(summary);
    return summary;
  }

  async stop(): Promise<CoverageSummary> {
    if (!this.started) return emptyCoverage(this.options.runId);
    if (this.timer) clearInterval(this.timer);
    await this.sample();
    await this.session.post("Profiler.stopPreciseCoverage");
    await this.session.post("Profiler.disable");
    await this.session.disconnect();
    this.started = false;
    const summary = summarizeCoverage(this.options.runId, this.latest, this.options);
    this.options.onUpdate?.(summary);
    return summary;
  }
}




