import { pathToFileURL } from "node:url";
import ts from "typescript";
import type { CoverageScript, SourceRange } from "@canary/core";

export const ISTANBUL_GLOBAL = "__canary_istanbul__";

export interface IstanbulCoverageFile {
  path: string;
  source: string;
  statementMap: Record<string, SourceRange>;
  fnMap: Record<string, { name: string; decl: SourceRange }>;
  branchMap: Record<string, { type: string; locations: SourceRange[] }>;
  s: Record<string, number>;
  f: Record<string, number>;
  b: Record<string, number[]>;
}

export type IstanbulCoverageMap = Record<string, IstanbulCoverageFile>;

function position(sourceFile: ts.SourceFile, offset: number): { line: number; column: number; offset: number } {
  const point = sourceFile.getLineAndCharacterOfPosition(Math.max(0, Math.min(offset, sourceFile.text.length)));
  return { line: point.line + 1, column: point.character + 1, offset };
}
function rangeFor(sourceFile: ts.SourceFile, node: ts.Node): SourceRange {
  return { start: position(sourceFile, node.getStart(sourceFile)), end: position(sourceFile, node.getEnd()) };
}

function collectLocations(source: string, filePath: string): {
  statements: SourceRange[];
  functions: Array<{ name: string; decl: SourceRange; body: SourceRange }>;
  branches: Array<{ type: string; locations: SourceRange[] }>;
} {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const statements: SourceRange[] = [];
  const functions: Array<{ name: string; decl: SourceRange; body: SourceRange }> = [];
  const branches: Array<{ type: string; locations: SourceRange[] }> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStatement(node) && !ts.isBlock(node) && !ts.isFunctionDeclaration(node) && !ts.isImportDeclaration(node) && !ts.isInterfaceDeclaration(node) && !ts.isTypeAliasDeclaration(node) && !ts.isEmptyStatement(node)) {
      statements.push(rangeFor(sourceFile, node));
    }
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)) && node.body) {
      functions.push({
        name: (node as ts.NamedDeclaration).name?.getText(sourceFile) ?? "(anonymous)",
        decl: rangeFor(sourceFile, node),
        body: rangeFor(sourceFile, node.body),
      });
    }
    if (ts.isIfStatement(node)) {
      const locations = [rangeFor(sourceFile, node.thenStatement)];
      if (node.elseStatement) locations.push(rangeFor(sourceFile, node.elseStatement));
      branches.push({ type: "if", locations });
    } else if (ts.isConditionalExpression(node)) {
      branches.push({ type: "conditional", locations: [rangeFor(sourceFile, node.whenTrue), rangeFor(sourceFile, node.whenFalse)] });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { statements, functions, branches };
}

export function createIstanbulFileCoverage(filePath: string, source: string): IstanbulCoverageFile {
  const collected = collectLocations(source, filePath);
  const statementMap: IstanbulCoverageFile["statementMap"] = {};
  const fnMap: IstanbulCoverageFile["fnMap"] = {};
  const branchMap: IstanbulCoverageFile["branchMap"] = {};
  const s: Record<string, number> = {};
  const f: Record<string, number> = {};
  const b: Record<string, number[]> = {};
  collected.statements.forEach((range, index) => { statementMap[index] = range; s[index] = 0; });
  collected.functions.forEach((fn, index) => { fnMap[index] = { name: fn.name, decl: fn.body }; f[index] = 0; });
  collected.branches.forEach((branch, index) => { branchMap[index] = branch; b[index] = branch.locations.map(() => 0); });
  return { path: filePath, source, statementMap, fnMap, branchMap, s, f, b };
}

function counter(path: string, bucket: "s" | "f", id: string): string {
  return `globalThis.${ISTANBUL_GLOBAL}[${JSON.stringify(path)}].${bucket}[${JSON.stringify(id)}]++;`;
}
function branchCounter(path: string, id: string, index: number): string {
  return `globalThis.${ISTANBUL_GLOBAL}[${JSON.stringify(path)}].b[${JSON.stringify(id)}][${index}]++;`;
}

export function instrumentIstanbul(source: string, filePath: string): { code: string; file: IstanbulCoverageFile } {
  const file = createIstanbulFileCoverage(filePath, source);
  const inserts: Array<{ offset: number; text: string }> = [];
  const wrapStatement = (range: SourceRange, increment: string): void => {
    if (range.start.offset === undefined || range.end.offset === undefined) return;
    inserts.push({ offset: range.start.offset, text: `{${increment}` });
    inserts.push({ offset: range.end.offset, text: "}" });
  };
  for (const [id, range] of Object.entries(file.statementMap)) wrapStatement(range, counter(filePath, "s", id));
  for (const [id, fn] of Object.entries(file.fnMap)) {
    const offset = fn.decl.start.offset;
    if (offset === undefined) continue;
    if (source[offset] === "{") inserts.push({ offset: offset + 1, text: counter(filePath, "f", id) });
    else if (fn.decl.end.offset !== undefined) {
      inserts.push({ offset, text: `(${counter(filePath, "f", id).replace(/;$/, "")}, ` });
      inserts.push({ offset: fn.decl.end.offset, text: ")" });
    }
  }
  for (const [id, branch] of Object.entries(file.branchMap)) {
    for (const [index, range] of branch.locations.entries()) wrapStatement(range, branchCounter(filePath, id, index));
  }
  inserts.sort((left, right) => right.offset - left.offset || right.text.length - left.text.length);
  let code = source;
  for (const insert of inserts) code = `${code.slice(0, insert.offset)}${insert.text}${code.slice(insert.offset)}`;
  const prelude = `globalThis.${ISTANBUL_GLOBAL}=globalThis.${ISTANBUL_GLOBAL}||{};globalThis.${ISTANBUL_GLOBAL}[${JSON.stringify(filePath)}]=${JSON.stringify(file)};`;
  return { code: `${prelude}${code}`, file };
}

export function readIstanbulCoverage(globalObject: Record<PropertyKey, unknown> = globalThis): IstanbulCoverageMap {
  const value = globalObject[ISTANBUL_GLOBAL];
  return value && typeof value === "object" ? value as IstanbulCoverageMap : {};
}

export function istanbulToScripts(coverage: IstanbulCoverageMap): CoverageScript[] {
  return Object.values(coverage).map((file) => {
    const ranges = [
      ...Object.entries(file.s).map(([id, count]) => {
        const range = file.statementMap[id]!;
        return { startOffset: range.start.offset ?? 0, endOffset: Math.max(range.end.offset ?? 0, (range.start.offset ?? 0) + 1), count };
      }),
      ...Object.entries(file.f).map(([id, count]) => {
        const range = file.fnMap[id]!.decl;
        return { startOffset: range.start.offset ?? 0, endOffset: Math.max(range.end.offset ?? 0, (range.start.offset ?? 0) + 1), count };
      }),
      ...Object.entries(file.b).flatMap(([id, counts]) => (file.branchMap[id]?.locations ?? []).map((range, index) => ({
        startOffset: range.start.offset ?? 0,
        endOffset: Math.max(range.end.offset ?? 0, (range.start.offset ?? 0) + 1),
        count: counts[index] ?? 0,
      }))),
    ];
    return { url: pathToFileURL(file.path).href, source: file.source, functions: [{ functionName: "(istanbul)", ranges }] };
  });
}
