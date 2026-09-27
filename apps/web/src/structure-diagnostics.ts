import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { CoverageManifest, CoverageManifestLocation, CoverageMetric, CoverageSummary } from "@canary/core";
import type { StructureNode, StructureSnapshot } from "@canary/structure";
import type { ProjectIssue } from "./project-issues.js";
import { readStructureSource } from "./structure-source.js";

export interface DiagnosticSource { runId: string; checkId?: string; coverage: CoverageSummary; manifest?: CoverageManifest }
export interface NodeMeasurement {
  nodeId: string;
  fileNodeId: string;
  runId: string;
  checkId?: string;
  status: string;
  precision: "exact" | "approximate" | "unknown";
  reason?: string;
  lines?: CoverageMetric;
  functions?: CoverageMetric;
  branches?: CoverageMetric;
  executableLines: number[];
  coveredLines: number[];
  uncoveredBranches: CoverageManifestLocation[];
  uncoveredFunctions: CoverageManifestLocation[];
}
export interface FailureLocation {
  issueId: string;
  runId: string;
  checkId?: string;
  title: string;
  category: string;
  summary: string;
  state: "current" | "historical" | "verified";
  verificationRunId?: string;
  nodeId?: string;
  fileNodeId?: string;
  path?: string;
  line?: number;
  column?: number;
  confidence: "path-line" | "unknown";
  reason?: string;
}

const metric = (covered: number, total: number): CoverageMetric => ({ covered, total, pct: total ? Math.round(covered / total * 1000) / 10 : 0 });
const matchedHash = (full?: string, abbreviated?: string) => Boolean(full && abbreviated && /^[a-f0-9]{16}(?:[a-f0-9]{48})?$/.test(abbreviated) && full.startsWith(abbreviated));
const local = (root: string, path: string) => relative(root, resolve(root, path)).split(sep).join("/");
const safe = (path: string) => Boolean(path && path !== "." && !path.startsWith("../") && !isAbsolute(path));
const within = (node: StructureNode, line: number) => node.line !== undefined && line >= node.line && line <= (node.endLine ?? node.line);
const contained = (node: StructureNode, location: CoverageManifestLocation) => node.line !== undefined && within(node, location.start.line) && location.end.line <= (node.endLine ?? node.line);
const unique = (numbers: number[]) => [...new Set(numbers.filter((line) => Number.isInteger(line) && line > 0))].sort((a, b) => a - b);

/** Keep separate denominators per source and per symbol; never distribute a file percentage across symbols. */
export function mapCoverageToStructure(snapshot: StructureSnapshot, sources: DiagnosticSource[]): NodeMeasurement[] {
  const root = resolve(snapshot.source.projectRoot);
  const files = new Map(snapshot.nodes.filter((node) => node.kind === "file").map((node) => [node.path, node]));
  const measurements: NodeMeasurement[] = [];
  for (const source of sources) for (const file of source.coverage.files ?? []) {
    const path = local(root, file.filePath);
    if (!safe(path)) continue;
    const node = files.get(path);
    if (!node) continue;
    const valid = matchedHash(node.sourceHash, file.sourceHash);
    const usable = valid && !["unavailable", "preparing"].includes(file.status);
    const manifestFile = source.manifest?.files.find((entry) => local(root, entry.filePath) === path && matchedHash(node.sourceHash, entry.sourceHash) && entry.sourceHash === file.sourceHash);
    const reason = !valid ? "源码哈希与运行快照不一致" : !usable ? "此文件未采集到可用覆盖率" : undefined;
    const precision = !usable ? "unknown" : file.quality?.precision ?? "unknown";
    const base: NodeMeasurement = {
      nodeId: node.id, fileNodeId: node.id, runId: source.runId, checkId: source.checkId,
      status: valid ? file.status : "source-mismatch", precision, reason,
      ...(usable ? { lines: file.lines, functions: file.functions, branches: file.branches } : {}),
      executableLines: usable ? unique(file.executableLineNumbers ?? manifestFile?.executableLines ?? []) : [],
      coveredLines: usable ? unique(file.coveredLineNumbers ?? []) : [],
      uncoveredBranches: usable ? (file.uncoveredLocations ?? []).filter((item) => (item as CoverageManifestLocation).kind === "branch" && Number.isInteger(item.start?.line)) as CoverageManifestLocation[] : [],
      uncoveredFunctions: usable ? (file.uncoveredLocations ?? []).filter((item) => (item as CoverageManifestLocation).kind === "function" && Number.isInteger(item.start?.line)) as CoverageManifestLocation[] : [],
    };
    measurements.push(base);
    if (!usable || !manifestFile) continue;
    for (const symbol of snapshot.nodes.filter((item) => (item.kind === "function" || item.kind === "class") && item.path === path && item.line !== undefined)) {
      const lines = base.executableLines.filter((line) => within(symbol, line));
      const covered = base.coveredLines.filter((line) => within(symbol, line));
      const functions = manifestFile.functionLocations.filter((item) => contained(symbol, item));
      const branches = manifestFile.branchLocations.filter((item) => contained(symbol, item));
      const measured: NodeMeasurement = {
        ...base, nodeId: symbol.id,
        lines: lines.length ? metric(covered.length, lines.length) : undefined,
        functions: functions.length ? metric(functions.filter((item) => item.id && file.coveredFunctionIds?.includes(item.id)).length, functions.length) : undefined,
        branches: branches.length ? metric(branches.filter((item) => item.id && file.coveredBranchIds?.includes(item.id)).length, branches.length) : undefined,
        executableLines: lines, coveredLines: covered,
        uncoveredBranches: base.uncoveredBranches.filter((item) => contained(symbol, item)),
        uncoveredFunctions: base.uncoveredFunctions.filter((item) => contained(symbol, item)),
      };
      if (measured.lines || measured.functions || measured.branches) measurements.push(measured);
    }
  }
  return measurements;
}

const stripAnsi = (value: string) => value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
function frames(value: string): Array<{ path: string; line: number; column?: number }> {
  const result: Array<{ path: string; line: number; column?: number }> = [];
  for (const row of stripAnsi(value).split(/\r?\n/).slice(0, 200)) {
    const python = row.match(/\bFile ["']([^"']+)["'], line (\d+)/);
    const node = row.match(/(?:\(|\s|^)([^\s()]+\.[cm]?[jt]sx?|[^\s()]+\.py):(\d+)(?::(\d+))?\)?(?:\s|$)/);
    if (python) result.push({ path: python[1]!, line: Number(python[2]) });
    else if (node) result.push({ path: node[1]!, line: Number(node[2]), column: node[3] ? Number(node[3]) : undefined });
  }
  return result;
}

/** Stack frames remain path/line evidence; they do not prove the executed bytes matched the static snapshot. */
export function mapFailuresToStructure(snapshot: StructureSnapshot, issues: ProjectIssue[], logs: Map<string, string>, historical = false): FailureLocation[] {
  const root = resolve(snapshot.source.projectRoot);
  const files = new Map(snapshot.nodes.filter((node) => node.kind === "file").map((node) => [node.path, node]));
  return issues.map((issue) => {
    const state = issue.status === "verified" ? "verified" : historical ? "historical" : "current";
    const logText = logs.get(issue.checkId ?? issue.title) ?? "";
    const diagnostic = stripAnsi(logText).split(/\r?\n/).find((line) => /^\s*(?:\w*Error|\w*Exception|Assertion failed|FAIL\b|error:)/i.test(line))?.trim();
    const base: FailureLocation = {
      issueId: issue.id, runId: issue.runId, checkId: issue.checkId, title: issue.title, category: issue.category, summary: (diagnostic ?? issue.summary).slice(0, 1600),
      state, verificationRunId: issue.verification?.runId, confidence: "unknown", reason: "错误证据没有可确认的项目源码位置",
    };
    const content = [logText, issue.summary].join("\n");
    for (const frame of frames(content)) {
      let framePath = frame.path;
      if (framePath.startsWith("file://")) {
        try { framePath = fileURLToPath(framePath); }
        catch { continue; }
      }
      const path = local(root, framePath);
      if (!safe(path) || !files.has(path)) continue;
      const file = files.get(path)!;
      if (!Number.isInteger(frame.line) || frame.line < 1 || (file.endLine && frame.line > file.endLine)) continue;
      const source = readStructureSource(snapshot, file.id, frame.line);
      if (!source || source.availability === "unavailable" || !source.startLine || !source.endLine || frame.line < source.startLine || frame.line > source.endLine) continue;
      const symbol = snapshot.nodes.filter((node) => node.path === path && (node.kind === "function" || node.kind === "class") && within(node, frame.line)).sort((a, b) => ((a.endLine ?? a.line!) - a.line!) - ((b.endLine ?? b.line!) - b.line!))[0];
      return { ...base, fileNodeId: file.id, nodeId: symbol?.id ?? file.id, path, line: frame.line, column: frame.column, confidence: "path-line" as const, reason: undefined };
    }
    return base;
  });
}

export function checkLogs(checks: Array<{ id: string; outputEvidence?: { stderr: string[]; stdout: string[] }; stderr?: string; stdout?: string }> = []): Map<string, string> {
  return new Map(checks.map((check) => [check.id, [check.outputEvidence?.stderr?.join("\n"), check.outputEvidence?.stdout?.join("\n"), check.stderr, check.stdout].filter(Boolean).join("\n").slice(0, 65536)]));
}
