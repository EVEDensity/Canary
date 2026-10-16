import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, win32 } from "node:path";
import type {
  CoverageFile,
  CoverageManifest,
  CoverageManifestFile,
  CoverageManifestLocation,
  CoverageSummary,
  SourcePosition,
} from "@canary/core";
import type { StructureSnapshot } from "@canary/structure";

export interface ChangedFileInput {
  path: string;
  changedLines: number[];
  source: string;
  coverage?: CoverageSummary;
  manifest?: CoverageManifest;
  coverageSources?: Array<{ coverage: CoverageSummary; manifest?: CoverageManifest }>;
  structure?: StructureSnapshot;
  root: string;
}

type Dimension = "lines" | "functions" | "branches";
type Metric = { total: number | null; covered: number | null };
type Observation = { domain: string[]; covered: Set<string>; signature: string };
const dimensions: Dimension[] = ["lines", "functions", "branches"];
const unknown = (): Metric => ({ total: null, covered: null });
const hash = (source: string) => createHash("sha256").update(source).digest("hex");
const normalizedText = (source: string) => source.replace(/\r\n/g, "\n");
const sameText = (left: string, right: string) => normalizedText(left) === normalizedText(right);
const matchesHash = (recorded: string, source: string) => {
  // Coverage's persisted sourceHash contract uses the first 16 SHA-256 hex digits.
  // Full SHA-256 is also accepted; arbitrary shorter prefixes are not identities.
  const digest = hash(source);
  return recorded === digest || recorded === digest.slice(0, 16);
};
function boundSource(recordedHash: string, displayed: string | undefined, historical: string): string | undefined {
  if (displayed === undefined) return matchesHash(recordedHash, historical) ? historical : undefined;
  if (sameText(displayed, historical) && matchesHash(recordedHash, displayed)) return displayed;
  // The artifact/RunStore privacy projection retains exactly 2,048 UTF-16 code
  // units plus U+2026. That display excerpt is not the executable source. Recover
  // only from the complete historical blob whose exact persisted hash matches;
  // an arbitrary mismatch, redacted prefix or a merely similar excerpt is unknown.
  if (
    historical.length > 2048 &&
    displayed === historical.slice(0, 2048) + "…" &&
    matchesHash(recordedHash, historical)
  )
    return historical;
  return undefined;
}
const overlaps = (start: number, end: number, lines: number[]) => lines.some((line) => start <= line && line <= end);

/** Resolve only paths inside the recorded project, including historical Windows paths on another host. */
function projectPath(path: string, root: string): string | undefined {
  if (typeof path !== "string" || !path || path.includes("\0") || /^[a-z]+:\/\//i.test(path)) return;
  const windowsRoot = win32.isAbsolute(root) && /^[a-z]:/i.test(root);
  const windowsPath = win32.isAbsolute(path) && (/^[a-z]:/i.test(path) || path.startsWith("\\\\"));
  let candidate: string;
  if (windowsPath || windowsRoot) {
    if (isAbsolute(path) && !windowsPath) return;
    candidate = win32.relative(win32.resolve(root), win32.resolve(root, path)).replaceAll("\\", "/");
  } else {
    candidate = relative(resolve(root), resolve(root, path.replaceAll("\\", "/"))).replaceAll("\\", "/");
  }
  if (
    !candidate ||
    candidate === ".." ||
    candidate.startsWith("../") ||
    isAbsolute(candidate) ||
    /^[a-z]:/i.test(candidate)
  )
    return;
  return candidate;
}

function validNumbers(values: unknown, maxLine: number): values is number[] {
  return (
    Array.isArray(values) &&
    values.every((value) => Number.isSafeInteger(value) && value > 0 && value <= maxLine) &&
    new Set(values).size === values.length
  );
}

function validIds(values: unknown): values is string[] {
  return (
    Array.isArray(values) &&
    values.every((value) => typeof value === "string" && value.length > 0 && !/[\x00-\x1f]/.test(value)) &&
    new Set(values).size === values.length
  );
}

function sourceLines(source: string) {
  const lines = source.split(/\r\n|\n|\r/);
  const starts = [0];
  for (const match of source.matchAll(/\r\n|\n|\r/g)) starts.push(match.index + match[0].length);
  return { lines, starts };
}

function validPosition(position: SourcePosition, source: ReturnType<typeof sourceLines>): boolean {
  if (
    !position ||
    !Number.isSafeInteger(position.line) ||
    position.line < 1 ||
    position.line > source.lines.length ||
    !Number.isSafeInteger(position.column) ||
    position.column < 0 ||
    position.column > source.lines[position.line - 1]!.length + 1
  )
    return false;
  // Legacy locations without offsets used column zero for the beginning of a line.
  return (
    position.offset === undefined ||
    (Number.isSafeInteger(position.offset) &&
      position.column >= 1 &&
      position.offset === source.starts[position.line - 1]! + position.column - 1)
  );
}

const beforeOrEqual = (left: SourcePosition, right: SourcePosition) =>
  left.line < right.line || (left.line === right.line && left.column <= right.column);

function locations(
  values: CoverageManifestLocation[],
  kind: "function" | "branch",
  source: string,
  input: ChangedFileInput,
): { ids: string[]; signature: string; selected: string[] } | undefined {
  if (!Array.isArray(values)) return;
  const text = sourceLines(source);
  const entries = [];
  for (const value of values) {
    if (
      !value ||
      typeof value.id !== "string" ||
      !value.id ||
      /[\x00-\x1f]/.test(value.id) ||
      value.kind !== kind ||
      projectPath(value.filePath, input.root) !== input.path ||
      !validPosition(value.start, text) ||
      !validPosition(value.end, text) ||
      !beforeOrEqual(value.start, value.end) ||
      (value.executionStart &&
        (!validPosition(value.executionStart, text) ||
          !beforeOrEqual(value.start, value.executionStart) ||
          !beforeOrEqual(value.executionStart, value.end))) ||
      (value.implicitElseOf &&
        (projectPath(value.implicitElseOf.filePath, input.root) !== input.path ||
          !validPosition(value.implicitElseOf.start, text) ||
          !validPosition(value.implicitElseOf.end, text) ||
          !beforeOrEqual(value.start, value.implicitElseOf.start) ||
          !beforeOrEqual(value.implicitElseOf.start, value.implicitElseOf.end) ||
          !beforeOrEqual(value.implicitElseOf.end, value.end)))
    )
      return;
    const point = (position: SourcePosition) => ({ line: position.line, column: position.column });
    entries.push({
      id: value.id,
      start: point(value.start),
      end: point(value.end),
      executionStart: value.executionStart && point(value.executionStart),
      implicitElseOf: value.implicitElseOf && {
        start: point(value.implicitElseOf.start),
        end: point(value.implicitElseOf.end),
      },
      branchType: value.branchType,
      branchIndex: value.branchIndex,
    });
  }
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) return;
  entries.sort((left, right) => left.id.localeCompare(right.id));
  return {
    ids: entries.map((entry) => entry.id),
    signature: JSON.stringify(entries),
    selected: entries
      .filter((entry) => overlaps(entry.start.line, entry.end.line, input.changedLines))
      .map((entry) => entry.id),
  };
}

/** Combine only exact, version-bound execution identities; percentages are never used as evidence. */
export function analyzeChangedFile(input: ChangedFileInput) {
  const observations: Record<Dimension, Observation[]> = { lines: [], functions: [], branches: [] };
  const conflicted = new Set<Dimension>();
  const reasons = new Set<string>();
  const addReason = (reason: string) => reasons.add(reason);
  const conflict = (dimension: Dimension, reason: string) => {
    conflicted.add(dimension);
    addReason(`${dimension}: ${reason}`);
  };
  const sources =
    input.coverageSources ?? (input.coverage ? [{ coverage: input.coverage, manifest: input.manifest }] : []);
  let matched = false;
  for (const { coverage, manifest } of sources) {
    const files = coverage.files?.filter((file) => projectPath(file.filePath, input.root) === input.path) ?? [];
    if (!files.length) continue;
    matched = true;
    if (files.length !== 1) {
      for (const dimension of dimensions) conflict(dimension, "conflicting coverage file identities");
      continue;
    }
    const file: CoverageFile = files[0]!;
    if (coverage.status !== "final" || !["final", "partial"].includes(file.status)) {
      addReason("Coverage collection is incomplete or unavailable");
      continue;
    }
    if (file.quality?.precision !== "exact") {
      addReason("Coverage source mapping is not exact");
      continue;
    }
    const source = boundSource(file.sourceHash, file.sourceText, input.source);
    if (source === undefined) {
      addReason("Coverage source hash or recorded text does not match the historical source");
      continue;
    }
    const manifestFiles =
      manifest?.files?.filter((value) => projectPath(value.filePath, input.root) === input.path) ?? [];
    let manifestFile: CoverageManifestFile | undefined;
    if (manifest && manifest.sourceHash !== coverage.sourceHash) {
      conflict("functions", "coverage and manifest collection identities conflict");
      conflict("branches", "coverage and manifest collection identities conflict");
    } else if (manifestFiles.length === 1) {
      const candidate = manifestFiles[0]!;
      const candidateSource = boundSource(candidate.sourceHash, candidate.sourceText, source);
      if (candidate.quality?.precision === "exact" && candidateSource !== undefined) manifestFile = candidate;
      else addReason("Manifest source identity or exact mapping is unavailable");
    } else if (manifestFiles.length > 1) {
      conflict("functions", "conflicting manifest file identities");
      conflict("branches", "conflicting manifest file identities");
    } else addReason("Exact historical coverage manifest is unavailable");

    const maxLine = sourceLines(source).lines.length;
    if (file.executableLineNumbers === undefined || file.coveredLineNumbers === undefined)
      addReason("lines: executable or covered line identities are unavailable");
    else if (
      !validNumbers(file.executableLineNumbers, maxLine) ||
      !validNumbers(file.coveredLineNumbers, maxLine) ||
      file.coveredLineNumbers.some((line) => !file.executableLineNumbers!.includes(line))
    )
      conflict("lines", "covered lines conflict with the executable line denominator");
    else {
      const domain = [...file.executableLineNumbers].sort((a, b) => a - b);
      if (
        manifestFile &&
        (!validNumbers(manifestFile.executableLines, maxLine) ||
          JSON.stringify([...manifestFile.executableLines].sort((a, b) => a - b)) !== JSON.stringify(domain))
      )
        conflict("lines", "manifest and coverage executable line denominators conflict");
      observations.lines.push({
        domain: domain.filter((line) => input.changedLines.includes(line)).map(String),
        covered: new Set(file.coveredLineNumbers.map(String)),
        signature: JSON.stringify(domain),
      });
    }

    for (const dimension of ["functions", "branches"] as const) {
      if (!manifestFile) {
        addReason(`${dimension}: exact historical manifest identities are unavailable`);
        continue;
      }
      const candidateSource = boundSource(manifestFile.sourceHash, manifestFile.sourceText, source)!;
      const identities = locations(
        dimension === "functions" ? manifestFile.functionLocations : manifestFile.branchLocations,
        dimension === "functions" ? "function" : "branch",
        candidateSource,
        input,
      );
      const covered = dimension === "functions" ? file.coveredFunctionIds : file.coveredBranchIds;
      if (!identities) {
        conflict(dimension, "manifest locations conflict with the historical source");
        continue;
      }
      if (covered === undefined) {
        addReason(`${dimension}: covered identities are unavailable`);
        continue;
      }
      if (!validIds(covered) || covered.some((id) => !identities.ids.includes(id))) {
        conflict(dimension, "covered identities conflict with the manifest denominator");
        continue;
      }
      observations[dimension].push({
        domain: identities.selected,
        covered: new Set(covered),
        signature: identities.signature,
      });
    }
  }
  if (!matched) addReason("No coverage source matches this historical project file");
  const execution: {
    status: "measured" | "unknown";
    lines: Metric;
    functions: Metric;
    branches: Metric;
    reasons: string[];
  } = { status: "unknown", lines: unknown(), functions: unknown(), branches: unknown(), reasons: [] };
  const uncovered: { lines: number[]; functions: string[]; branches: string[] } = {
    lines: [],
    functions: [],
    branches: [],
  };
  for (const dimension of dimensions) {
    const values = observations[dimension];
    if (new Set(values.map((value) => value.signature)).size > 1)
      conflict(dimension, "denominator or location identities conflict across coverage sources");
    if (!values.length || conflicted.has(dimension)) continue;
    const domain = values[0]!.domain;
    const covered = new Set(values.flatMap((value) => [...value.covered]));
    const missing = domain.filter((id) => !covered.has(id));
    execution[dimension] = { total: domain.length, covered: domain.length - missing.length };
    if (dimension === "lines") uncovered.lines = missing.map(Number);
    else uncovered[dimension] = missing;
  }
  execution.status = dimensions.some((dimension) => execution[dimension].total !== null) ? "measured" : "unknown";
  execution.reasons = [...reasons].sort();
  return {
    path: input.path,
    changedLines: input.changedLines,
    execution,
    uncovered,
    nodes: (input.structure?.nodes ?? [])
      .filter(
        (node) =>
          node.path === input.path &&
          (node.kind === "file" || (node.line && overlaps(node.line, node.endLine ?? node.line, input.changedLines))),
      )
      .map((node) => ({ id: node.id, kind: node.kind, ...(node.line === undefined ? {} : { line: node.line }) })),
    interpretation: "Execution coverage does not establish behavior verification",
  };
}
