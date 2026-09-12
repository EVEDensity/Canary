import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Session } from "node:inspector";
import ts from "typescript";
import { canonicalPath, prepareScript, scriptTargets, createProbe } from "./source-mapping.js";
import { istanbulToScripts, readIstanbulCoverage } from "./istanbul.js";
import type {
  CoverageFile,
  CoverageFragment,
  CoverageManifest,
  CoverageManifestFile,
  CoverageManifestLocation,
  CoverageMetric,
  CoverageProvider,
  CoverageScript,
  CoverageSummary,
  FeatureCoverage,
  FeatureDefinition,
  SourceLocation,
  SourceRange,
} from "@canary/core";

export interface CoverageSourceConfig {
  rootDir?: string;
  include: string[];
  exclude?: string[];
  sourceText?: (filePath: string) => string | undefined;
  manifest?: CoverageManifest;
  features?: FeatureDefinition[];
  sampleIntervalMs?: number;
  sampleMinIntervalMs?: number;
  provider?: "v8" | "istanbul";
  /** @deprecated Use features. Retained for pre-P0 configuration compatibility. */
  featureChains?: Record<string, { name?: string; files: string[]; lines?: Array<{ start: number; end: number }> }>;
}
export interface CoverageOptions extends CoverageSourceConfig {
  runId: string;
  executionId: string;
  sampleIntervalMs?: number;
  onUpdate?: (summary: CoverageSummary) => void;
}
export interface CoverageSession { executionId: string; startedAt: string; status: "running" | "final" | "partial" | "unavailable" }

export function emptyMetric(): CoverageMetric { return { covered: 0, total: 0, pct: 0 }; }
export function metric(covered: number, total: number): CoverageMetric {
  const safeTotal = Math.max(0, total);
  const safeCovered = Math.max(0, Math.min(covered, safeTotal));
  return { covered: safeCovered, total: safeTotal, pct: safeTotal === 0 ? 0 : Number(((safeCovered / safeTotal) * 100).toFixed(2)) };
}
export function createCoverageSession(executionId: string): CoverageSession { return { executionId, startedAt: new Date().toISOString(), status: "running" }; }
export function emptyCoverage(runId: string, sourceHash = "unknown"): CoverageSummary {
  return { runId, sourceHash, status: "unavailable", lines: emptyMetric(), statements: emptyMetric(), functions: emptyMetric(), branches: emptyMetric(), files: [], featureChains: [] };
}
export function preparingCoverage(runId: string, sourceHash = "pending"): CoverageSummary {
  return { ...emptyCoverage(runId, sourceHash), status: "preparing" };
}

/** Canonical absolute path used for both Windows paths and file URLs. */
export const normalizeCoveragePath = canonicalPath;
function patternToRegExp(pattern: string): RegExp {
  const normalized = pattern.replaceAll("\\", "/").replace(/^\.\//, "");
  let expression = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index] ?? "";
    if (char === "*" && normalized[index + 1] === "*") {
      if (normalized[index + 2] === "/") { expression += "(?:.*/)?"; index += 2; }
      else { expression += ".*"; index += 1; }
    } else if (char === "*") expression += "[^/]*";
    else if (char === "?") expression += "[^/]";
    else expression += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${expression}$`);
}
function matches(filePath: string, patterns: string[], rootDir: string): boolean {
  const value = relative(rootDir, filePath).split(sep).join("/");
  return patterns.some((pattern) => patternToRegExp(pattern).test(value));
}
function sourceFor(filePath: string, options: CoverageSourceConfig): string | undefined {
  const supplied = options.sourceText?.(filePath);
  if (supplied !== undefined) return supplied;
  try { return existsSync(filePath) ? readFileSync(filePath, "utf8") : undefined; } catch { return undefined; }
}
export function sourceHash(text: string): string { return createHash("sha256").update(text).digest("hex").slice(0, 16); }
function manifestHash(files: CoverageManifestFile[]): string {
  const digest = createHash("sha256");
  for (const file of [...files].sort((a, b) => a.filePath.localeCompare(b.filePath))) digest.update(file.filePath).update("\0").update(file.sourceHash);
  return digest.digest("hex").slice(0, 16);
}
function position(sourceFile: ts.SourceFile, offset: number): { line: number; column: number; offset: number } {
  const point = sourceFile.getLineAndCharacterOfPosition(Math.max(0, Math.min(offset, sourceFile.text.length)));
  return { line: point.line + 1, column: point.character + 1, offset };
}
function sourceRange(sourceFile: ts.SourceFile, start: number, end: number): SourceRange {
  return { start: position(sourceFile, start), end: position(sourceFile, end) };
}
function nodeRange(sourceFile: ts.SourceFile, node: ts.Node): SourceRange {
  return sourceRange(sourceFile, node.getStart(sourceFile), node.getEnd());
}
function isExecutableStatement(node: ts.Statement): boolean {
  return !ts.isImportDeclaration(node) && !ts.isImportEqualsDeclaration(node) && !ts.isInterfaceDeclaration(node) && !ts.isTypeAliasDeclaration(node) && !ts.isEmptyStatement(node) && !ts.isModuleDeclaration(node);
}
function addLocation(target: CoverageManifestLocation[], kind: CoverageManifestLocation["kind"], filePath: string, sourceFile: ts.SourceFile, node: ts.Node, extra: Partial<CoverageManifestLocation> = {}): void {
  const range = nodeRange(sourceFile, node);
  target.push({ id: `${filePath}:${kind}:${range.start.offset ?? 0}${extra.branchIndex === undefined ? "" : `:${extra.branchIndex}`}`, kind, filePath, ...range, ...extra });
}
function buildManifestFile(filePath: string, text: string): CoverageManifestFile {
  const canonical = normalizeCoveragePath(filePath) ?? resolve(filePath);
  const sourceFile = ts.createSourceFile(canonical, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const statements: CoverageManifestLocation[] = [];
  const functions: CoverageManifestLocation[] = [];
  const branches: CoverageManifestLocation[] = [];
  const executable = new Set<number>();
  const visit = (node: ts.Node): void => {
    if (ts.isStatement(node) && !ts.isBlock(node) && !ts.isFunctionDeclaration(node) && isExecutableStatement(node)) {
      addLocation(statements, "statement", canonical, sourceFile, node);
      executable.add(position(sourceFile, node.getStart(sourceFile)).line);
    }
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
      if (node.body) addLocation(functions, "function", canonical, sourceFile, node, { symbol: (node as ts.NamedDeclaration).name?.getText(sourceFile), executionStart: position(sourceFile, node.body.getStart(sourceFile) + (ts.isBlock(node.body) ? 1 : 0)) });
    }
    if (ts.isIfStatement(node)) {
      addLocation(branches, "branch", canonical, sourceFile, node.thenStatement, { branchType: "if", branchIndex: 0 });
      if (node.elseStatement) addLocation(branches, "branch", canonical, sourceFile, node.elseStatement, { branchType: "if", branchIndex: 1 });
      else addLocation(branches, "branch", canonical, sourceFile, node, { branchType: "if", branchIndex: 1, implicitElseOf: { filePath: canonical, ...nodeRange(sourceFile, node.thenStatement) } });
    } else if (ts.isConditionalExpression(node)) {
      addLocation(branches, "branch", canonical, sourceFile, node.whenTrue, { branchType: "conditional", branchIndex: 0 });
      addLocation(branches, "branch", canonical, sourceFile, node.whenFalse, { branchType: "conditional", branchIndex: 1 });
    } else if (ts.isSwitchStatement(node)) {
      node.caseBlock.clauses.forEach((clause, index) => addLocation(branches, "branch", canonical, sourceFile, clause, { branchType: "switch", branchIndex: index }));
    } else if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || node.operatorToken.kind === ts.SyntaxKind.BarBarToken || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) {
      addLocation(branches, "branch", canonical, sourceFile, node.left, { branchType: "logical", branchIndex: 0 });
      addLocation(branches, "branch", canonical, sourceFile, node.right, { branchType: "logical", branchIndex: 1 });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return {
    filePath: canonical,
    sourceHash: sourceHash(text),
    sourceText: text,
    executableLines: [...executable].sort((a, b) => a - b),
    statementLocations: statements,
    functionLocations: functions,
    branchLocations: branches,
    quality: { mappingMode: "ast", precision: "exact", diagnostics: [] },
  };
}
function walkFiles(rootDir: string): string[] {
  const result: string[] = [];
  if (!existsSync(rootDir)) return result;
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const path = resolve(directory, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        if (!entry.startsWith(".") && entry !== "node_modules" && entry !== "dist") visit(path);
      } else if (/\.[cm]?[jt]sx?$/.test(entry) && !entry.endsWith(".d.ts")) result.push(path);
    }
  };
  visit(rootDir);
  return result;
}
export function createCoverageManifest(options: CoverageSourceConfig): CoverageManifest {
  const rootDir = resolve(options.rootDir ?? process.cwd());
  const candidates = walkFiles(rootDir).filter((file) => matches(file, options.include, rootDir) && !matches(file, options.exclude ?? [], rootDir));
  const files = candidates.map((file) => buildManifestFile(file, sourceFor(file, options) ?? ""));
  return { sourceHash: manifestHash(files), rootDir, include: [...options.include], exclude: [...(options.exclude ?? [])], files, features: [...(options.features ?? legacyFeatures(options))] };
}
export function createCoverageManifestForFile(filePath: string, sourceText?: string): CoverageManifestFile {
  const canonical = resolve(filePath);
  return buildManifestFile(canonical, sourceText ?? readFileSync(canonical, "utf8"));
}
function legacyFeatures(options: CoverageSourceConfig): FeatureDefinition[] {
  return Object.entries(options.featureChains ?? {}).map(([id, feature]) => ({ id, name: feature.name, files: feature.files, lines: feature.lines }));
}
function configuredFiles(options: CoverageSourceConfig, observed: string[]): CoverageManifestFile[] {
  if (options.manifest) return options.manifest.files;
  const root = resolve(options.rootDir ?? process.cwd());
  const files = walkFiles(root).filter((file) => matches(file, options.include, root) && !matches(file, options.exclude ?? [], root));
  for (const pattern of options.include) {
    if (/[*?]/.test(pattern)) continue;
    const explicit = resolve(root, pattern);
    if (!files.some((file) => normalizeCoveragePath(file, root) === normalizeCoveragePath(explicit, root)) && !matches(explicit, options.exclude ?? [], root)) files.push(explicit);
  }
  for (const file of observed) if (!files.some((existing) => normalizeCoveragePath(existing, root) === normalizeCoveragePath(file, root)) && matches(file, options.include, root) && !matches(file, options.exclude ?? [], root)) files.push(file);
  const unique = [...new Map(files.map((file) => [normalizeCoveragePath(file, root) ?? file, file])).values()];
  return unique.map((file) => buildManifestFile(file, sourceFor(file, options) ?? ""));
}
function coverageForFile(manifestFile: CoverageManifestFile, prepared: ReturnType<typeof prepareScript>[]): CoverageFile {
  const probes = prepared.filter((script) => scriptTargets(script, manifestFile.filePath)).map((script) => createProbe(manifestFile, script));
  if (!probes.length) probes.push(createProbe(manifestFile));
  const count = (location: CoverageManifestLocation): number => Math.max(...probes.map((probe) => probe.count(location)));
  const covered = (location: CoverageManifestLocation): boolean => {
    if (location.implicitElseOf) {
      const consequent = { ...location.implicitElseOf, kind: "branch" as const };
      return count(location) > count(consequent);
    }
    return count(location) > 0;
  };
  const statements = manifestFile.statementLocations.filter(covered);
  const functions = manifestFile.functionLocations.filter(covered);
  const branches = manifestFile.branchLocations.filter(covered);
  const lineHits = new Set(statements.map((location) => location.start.line));
  const allLocations = [...manifestFile.statementLocations, ...manifestFile.functionLocations, ...manifestFile.branchLocations];
  const uncoveredLocations = allLocations.filter((location) => !covered(location));
  const available = probes.some((probe) => probe.available);
  const diagnostics = [...new Set(probes.flatMap((probe) => probe.quality.diagnostics))];
  if (manifestFile.branchLocations.some((location) => location.implicitElseOf)) diagnostics.push("IMPLICIT_ELSE_COUNTER_INFERENCE");
  const quality = { mappingMode: probes.some((probe) => probe.quality.mappingMode === "source-map") ? "source-map" as const : "ast" as const,
    precision: !available ? "unknown" as const : diagnostics.length ? "approximate" as const : "exact" as const, diagnostics };
  return {
    filePath: manifestFile.filePath, sourceHash: manifestFile.sourceHash,
    status: !available ? "unavailable" : uncoveredLocations.length ? "partial" : "final", quality,
    lines: metric(lineHits.size, manifestFile.executableLines.length),
    statements: metric(statements.length, manifestFile.statementLocations.length),
    functions: metric(functions.length, manifestFile.functionLocations.length),
    branches: metric(branches.length, manifestFile.branchLocations.length), uncoveredLocations,
    sourceText: manifestFile.sourceText,
    executableLineNumbers: manifestFile.executableLines, coveredLineNumbers: [...lineHits],
    coveredStatementIds: statements.map((location) => location.id!),
    coveredFunctionIds: functions.map((location) => location.id!),
    coveredBranchIds: branches.map((location) => location.id!),
  };
}
function aggregate(files: CoverageFile[], key: "lines" | "statements" | "functions" | "branches"): CoverageMetric {
  return metric(files.reduce((total, file) => total + file[key].covered, 0), files.reduce((total, file) => total + file[key].total, 0));
}
function selectedLocations(files: CoverageFile[], feature: FeatureDefinition, rootDir: string): { total: number; covered: number; uncovered: SourceLocation[] } {
  const wantedLines = feature.lines?.length ? new Set(feature.lines.flatMap((range) => Array.from({ length: range.end - range.start + 1 }, (_, index) => range.start + index))) : undefined;
  const scopedFiles = files.filter((file) => feature.files.some((pattern) => matches(file.filePath, [pattern], rootDir) || file.filePath.endsWith(pattern.replace(/^\.\//, "").replaceAll("/", sep))));
  if (!wantedLines) return { total: scopedFiles.reduce((total, file) => total + file.lines.total, 0), covered: scopedFiles.reduce((total, file) => total + file.lines.covered, 0), uncovered: scopedFiles.flatMap((file) => file.uncoveredLocations) };
  const executable = new Set(scopedFiles.flatMap((file) => (file.executableLineNumbers ?? []).filter((line) => wantedLines.has(line))));
  const total = executable.size || wantedLines.size;
  const coveredLines = new Set(scopedFiles.flatMap((file) => file.coveredLineNumbers ?? []).filter((line) => wantedLines.has(line)));
  const uncoveredLines = new Set([...executable].filter((line) => !coveredLines.has(line)));
  const uncovered = scopedFiles.flatMap((file) => file.uncoveredLocations.filter((location) => uncoveredLines.has(location.start.line)));
  return { total, covered: Math.min(total, coveredLines.size), uncovered };
}
export interface FeatureEvent { featureId: string; status: "entered" | "completed" | "failed"; caseId?: string }
export function assignFeatureCoverage(summary: CoverageSummary, features: FeatureDefinition[], events: FeatureEvent[] = [], expectedFeatures: string[] = [], caseId?: string, rootDir = process.cwd()): CoverageSummary {
  const files = summary.files ?? [];
  const featureChains: FeatureCoverage[] = features.map((feature) => {
    const observed = events.filter((event) => event.featureId === feature.id);
    const expected = expectedFeatures.includes(feature.id);
    const selected = selectedLocations(files, feature, rootDir);
    const failed = observed.some((event) => event.status === "failed");
    const completed = observed.some((event) => event.status === "completed");
    const entered = observed.some((event) => event.status === "entered");
    const coverage = metric(selected.covered, selected.total);
    const status = failed ? "failed" : selected.total === 0 ? "unavailable" : completed && coverage.covered === coverage.total ? "covered" : completed || entered ? "partial" : "uncovered";
    return {
      featureId: feature.id,
      name: feature.name ?? feature.id,
      status,
      caseIds: observed.length && caseId ? [caseId] : [],
      expectedCaseIds: expected && caseId ? [caseId] : [],
      failedCaseIds: failed && caseId ? [caseId] : [],
      filePaths: files.filter((file) => feature.files.some((pattern) => matches(file.filePath, [pattern], rootDir) || file.filePath.endsWith(pattern.replace(/^\.\//, "").replaceAll("/", sep)))).map((file) => file.filePath),
      coverage,
      uncoveredLocations: selected.uncovered,
    };
  });
  return { ...summary, featureChains };
}
export function summarizeCoverage(runId: string, scripts: CoverageScript[], options: CoverageSourceConfig): CoverageSummary {
  const rootDir = resolve(options.rootDir ?? process.cwd());
  const manifestFiles = configuredFiles(options, scripts.map((script) => normalizeCoveragePath(script.url, rootDir)).filter((file): file is string => Boolean(file)));
  const prepared = scripts.map((script) => prepareScript(script, rootDir));
  const files = manifestFiles.map((file) => coverageForFile(file, prepared));
  const manifest = options.manifest ?? { files: manifestFiles, sourceHash: manifestHash(manifestFiles) };
  const initial: CoverageSummary = { runId, sourceHash: manifest.sourceHash, status: "final", lines: aggregate(files, "lines"), statements: aggregate(files, "statements"), functions: aggregate(files, "functions"), branches: aggregate(files, "branches"), files, featureChains: [] };
  return assignFeatureCoverage(initial, options.features ?? legacyFeatures(options), [], [], undefined, rootDir);
}
export function mergeCoverageSummaries(runId: string, summaries: CoverageSummary[], features: FeatureDefinition[] = [], rootDir = process.cwd()): CoverageSummary {
  if (!summaries.length) return emptyCoverage(runId);
  const byPath = new Map<string, CoverageFile[]>();
  for (const summary of summaries) for (const file of summary.files ?? []) byPath.set(file.filePath, [...(byPath.get(file.filePath) ?? []), file]);
  const files = [...byPath.values()].map((items) => {
    const base = items[0]!;
    const line = new Set(items.flatMap((item) => item.coveredLineNumbers ?? []));
    const statement = new Set(items.flatMap((item) => item.coveredStatementIds ?? []));
    const fn = new Set(items.flatMap((item) => item.coveredFunctionIds ?? []));
    const branch = new Set(items.flatMap((item) => item.coveredBranchIds ?? []));
    return { ...base, status: items.some((item) => item.status === "final") ? "final" as const : base.status, lines: metric(line.size, base.lines.total), statements: metric(statement.size, base.statements.total), functions: metric(fn.size, base.functions.total), branches: metric(branch.size, base.branches.total), coveredLineNumbers: [...line], coveredStatementIds: [...statement], coveredFunctionIds: [...fn], coveredBranchIds: [...branch] };
  });
  const merged: CoverageSummary = { runId, sourceHash: summaries[0]!.sourceHash, status: summaries.every((summary) => summary.status === "unavailable") ? "unavailable" : summaries.every((summary) => summary.status === "final") ? "final" : "partial", lines: aggregate(files, "lines"), statements: aggregate(files, "statements"), functions: aggregate(files, "functions"), branches: aggregate(files, "branches"), files, featureChains: [] };
  const sourceFeatures = features.length ? features : summaries.flatMap((summary) => summary.featureChains.map((feature) => ({ id: feature.featureId, name: feature.name, files: feature.filePaths })));
  const featureChains: FeatureCoverage[] = sourceFeatures.map((feature) => {
    const items = summaries.flatMap((summary) => summary.featureChains.filter((item) => item.featureId === feature.id));
    const caseIds = [...new Set(items.flatMap((item) => item.caseIds))];
    const expectedCaseIds = [...new Set(items.flatMap((item) => item.expectedCaseIds))];
    const failedCaseIds = [...new Set(items.flatMap((item) => item.failedCaseIds))];
    const selected = selectedLocations(files, feature, rootDir);
    const coverage = metric(selected.covered, selected.total);
    const filePaths = files.filter((file) => feature.files.some((pattern) => matches(file.filePath, [pattern], rootDir) || file.filePath.endsWith(pattern.replace(/^\.\//, "").replaceAll("/", sep)))).map((file) => file.filePath);
    const observed = items.some((item) => item.status === "covered" || item.status === "partial" || item.status === "failed");
    const status = failedCaseIds.length ? "failed" : selected.total === 0 ? "unavailable" : coverage.covered === coverage.total && items.some((item) => item.status === "covered") ? "covered" : observed || coverage.covered > 0 ? "partial" : "uncovered";
    return { featureId: feature.id, name: feature.name ?? feature.id, status, caseIds, expectedCaseIds, failedCaseIds, filePaths, coverage, uncoveredLocations: selected.uncovered };
  });
  return { ...merged, featureChains };
}

const featureEmitter = Symbol.for("canary.feature.emit");
function emitFeature(event: { type: "feature.enter" | "feature.exit"; featureId: string; status?: "completed" | "failed" }): void {
  const callback = (globalThis as Record<PropertyKey, unknown>)[featureEmitter];
  if (typeof callback === "function") (callback as (value: typeof event) => void)(event);
}
export function feature<T>(featureId: string, run: () => T): T {
  emitFeature({ type: "feature.enter", featureId });
  try {
    const result = run();
    if (result && typeof (result as unknown as PromiseLike<unknown>).then === "function") {
      return (result as unknown as PromiseLike<unknown>).then(
        (value) => { emitFeature({ type: "feature.exit", featureId, status: "completed" }); return value; },
        (error) => { emitFeature({ type: "feature.exit", featureId, status: "failed" }); throw error; },
      ) as T;
    }
    emitFeature({ type: "feature.exit", featureId, status: "completed" });
    return result;
  } catch (error) { emitFeature({ type: "feature.exit", featureId, status: "failed" }); throw error; }
}

export class V8CoverageCollector implements CoverageProvider {
  readonly id = "node-v8" as const;
  private readonly session = new Session();
  private timer?: NodeJS.Timeout;
  private started = false;
  private stopping?: Promise<CoverageFragment>;
  private latest: CoverageScript[] = [];
  private lastFragment?: CoverageFragment;
  constructor(private readonly options: CoverageOptions) {}
  async start(): Promise<void> {
    if (this.started) return;
    this.session.connect();
    try { await this.post("Profiler.enable"); await this.post("Profiler.startPreciseCoverage", { callCount: true, detailed: true }); this.started = true; this.timer = setInterval(() => { void this.sample(); }, this.options.sampleIntervalMs ?? 1000); }
    catch (error) { await this.cleanup(); throw error; }
  }
  async sample(): Promise<CoverageFragment> {
    if (!this.started) return this.lastFragment ?? this.fragment("unavailable");
    try { const response = await this.post("Profiler.takePreciseCoverage") as { result?: CoverageScript[] }; this.latest = response.result ?? []; const fragment = this.fragment("final"); this.options.onUpdate?.(summarizeCoverage(this.options.runId, this.latest, this.options)); return fragment; }
    catch { return this.fragment("partial"); }
  }
  async stop(): Promise<CoverageFragment> { if (this.lastFragment) return this.lastFragment; this.stopping ??= this.finish(); this.lastFragment = await this.stopping; return this.lastFragment; }
  private async finish(): Promise<CoverageFragment> {
    if (!this.started) return this.fragment("unavailable");
    if (this.timer) clearInterval(this.timer);
    try { await this.sample(); await this.post("Profiler.stopPreciseCoverage"); await this.post("Profiler.disable"); return this.fragment("final"); }
    catch { return this.fragment("partial"); }
    finally { await this.cleanup(); }
  }
  private fragment(status: CoverageFragment["status"]): CoverageFragment { return { runId: this.options.runId, executionId: this.options.executionId, provider: "node-v8", processId: process.pid, isolateId: String(process.pid), sequence: Date.now(), sourceHash: summarizeCoverage(this.options.runId, this.latest, this.options).sourceHash, capturedAt: new Date().toISOString(), scripts: this.latest, status }; }
  private post(method: string, params: object = {}): Promise<unknown> { return new Promise((resolvePromise, reject) => this.session.post(method, params, (error, result) => error ? reject(error) : resolvePromise(result))); }
  private async cleanup(): Promise<void> { if (this.timer) clearInterval(this.timer); this.timer = undefined; this.started = false; try { this.session.disconnect(); } catch { /* disconnected */ } }
}

export function summarizeIstanbulCoverage(runId: string, coverage: import("./istanbul.js").IstanbulCoverageMap, options: CoverageSourceConfig): CoverageSummary {
  const summary = summarizeCoverage(runId, istanbulToScripts(coverage), options);
  return {
    ...summary,
    files: summary.files?.map((file) => ({
      ...file,
      quality: { mappingMode: "ast" as const, precision: "exact" as const, diagnostics: ["ISTANBUL_INSTRUMENTATION"] },
    })),
  };
}

export class IstanbulCoverageProvider implements CoverageProvider {
  readonly id = "istanbul" as const;
  constructor(private readonly options: CoverageOptions) {}
  async start(): Promise<void> { /* counters live on the instrumented module */ }
  async sample(): Promise<CoverageFragment> { return this.fragment(); }
  async stop(): Promise<CoverageFragment> { return this.fragment(); }
  private fragment(): CoverageFragment {
    const coverage = readIstanbulCoverage();
    return {
      runId: this.options.runId,
      executionId: this.options.executionId,
      provider: "istanbul",
      processId: process.pid,
      isolateId: String(process.pid),
      sequence: 1,
      phase: "final",
      sourceHash: summarizeIstanbulCoverage(this.options.runId, coverage, this.options).sourceHash,
      capturedAt: new Date().toISOString(),
      scripts: istanbulToScripts(coverage),
      status: "final",
    };
  }
}

export { instrumentIstanbul, istanbulToScripts, readIstanbulCoverage, ISTANBUL_GLOBAL } from "./istanbul.js";
export { dedupeCoverageFragments, mergeCoverageFragments, mergeV8Scripts, fragmentKey } from "./fragments.js";
export { SOURCE_MAP_PRECISION } from "./source-mapping.js";

export function benchmarkCoverageSummarize(iterations = 250): { opsPerSec: number; elapsedMs: number; iterations: number } {
  const source = "function one(value) {\n  if (value) return true;\n  return false;\n}\nfunction two() { return 0; }\n";
  const script = { url: "file:///workspace/bench.js", source, functions: [{ functionName: "one", ranges: [{ startOffset: 0, endOffset: 70, count: 1 }] }] };
  const started = Date.now();
  for (let index = 0; index < iterations; index += 1) summarizeCoverage("run_bench", [script], { rootDir: "/workspace", include: ["bench.js"], sourceText: () => source });
  const elapsedMs = Math.max(1, Date.now() - started);
  return { opsPerSec: Number(((iterations / elapsedMs) * 1000).toFixed(2)), elapsedMs, iterations };
}








