/** Local-only source-map resolution and coverage probes. Never fetches remote maps. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SourceMapConsumer, type RawSourceMap } from "source-map-js/source-map.js";
import type { CoverageManifestFile, CoverageManifestLocation, CoverageQuality, CoverageScript } from "@canary/core";

export function canonicalPath(value: string, rootDir = process.cwd()): string | undefined {
  if (!value || (/^[a-z][a-z+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value) && !value.startsWith("file:"))) return undefined;
  try {
    let input = value;
    if (value.startsWith("file:")) {
      try { input = fileURLToPath(value); }
      catch {
        const parsed = new URL(value);
        input = decodeURIComponent(parsed.pathname);
        if (parsed.host) input = `//${parsed.host}${input}`;
      }
    }
    const path = resolve(rootDir, input);
    return process.platform === "win32" ? path.replace(/^[A-Z]:/, (drive) => drive.toLowerCase()) : path;
  } catch { return undefined; }
}
function lineOffsets(text: string): number[] {
  const offsets = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") offsets.push(i + 1);
  return offsets;
}
function hash(text: string): string { return createHash("sha256").update(text).digest("hex").slice(0, 16); }
interface Point { original: number; generated: number }
export interface PreparedScript {
  script: CoverageScript;
  path?: string;
  consumer?: SourceMapConsumer;
  mapDirectory: string;
  diagnostic?: string;
}
export function prepareScript(script: CoverageScript, rootDir: string): PreparedScript {
  const path = canonicalPath(script.url, rootDir);
  const result: PreparedScript = { script, path, mapDirectory: path ? dirname(path) : rootDir };
  const directives = [...(script.source ?? "").matchAll(/(?:\/\/[#@]\s*sourceMappingURL=([^\s]+)|\/\*[#@]\s*sourceMappingURL=([^\s*]+)\s*\*\/)/g)];
  const directive = directives.at(-1);
  const url = script.sourceMapUrl ?? directive?.[1] ?? directive?.[2];
  let raw = script.sourceMap;
  try {
    if (!raw && url) {
      if (url.startsWith("data:")) raw = url;
      else {
        const mapPath = canonicalPath(decodeURIComponent(url), result.mapDirectory);
        if (!mapPath) throw new Error("REMOTE_OR_INVALID_MAP_URL");
        result.mapDirectory = dirname(mapPath);
        raw = readFileSync(mapPath, "utf8");
      }
    } else if (raw && url && !url.startsWith("data:")) {
      const mapPath = canonicalPath(url, result.mapDirectory);
      if (mapPath) result.mapDirectory = dirname(mapPath);
    }
    if (!raw) return result;
    if (raw.startsWith("data:")) {
      const comma = raw.indexOf(",");
      raw = raw.slice(0, comma).includes(";base64")
        ? Buffer.from(raw.slice(comma + 1), "base64").toString("utf8")
        : decodeURIComponent(raw.slice(comma + 1));
    }
    result.consumer = new SourceMapConsumer(JSON.parse(raw) as RawSourceMap);
  } catch (error) { result.diagnostic = `SOURCE_MAP_INVALID: ${error instanceof Error ? error.message : String(error)}`; }
  return result;
}
export function scriptTargets(prepared: PreparedScript, filePath: string): boolean {
  const target = canonicalPath(filePath);
  return prepared.path === target || !!prepared.consumer?.sources.some((source) => canonicalPath(source, prepared.mapDirectory) === target);
}
/** The innermost range wins: an executed module must not cover an uncalled function. */
function countAt(script: CoverageScript, offset: number): number {
  const ranges = script.functions.flatMap((fn) => fn.ranges).filter((range) => range.startOffset <= offset && offset < range.endOffset);
  ranges.sort((a, b) => (a.endOffset - a.startOffset) - (b.endOffset - b.startOffset) || a.count - b.count);
  return ranges[0]?.count ?? 0;
}
export interface CoverageProbe { quality: CoverageQuality; available: boolean; count(location: CoverageManifestLocation): number }
export function createProbe(file: CoverageManifestFile, prepared?: PreparedScript): CoverageProbe {
  const unavailable = (diagnostic: string, mappingMode: CoverageQuality["mappingMode"] = "ast"): CoverageProbe => ({
    quality: { mappingMode, precision: "unknown", diagnostics: [diagnostic] }, available: false, count: () => 0,
  });
  if (!prepared) return unavailable("SCRIPT_NOT_LOADED");
  const { script, consumer } = prepared;
  if (prepared.diagnostic) return unavailable(prepared.diagnostic, "source-map");
  const anchor = (location: CoverageManifestLocation) => location.executionStart?.offset ?? location.start.offset ?? 0;
  // Identical source is the only safe direct-offset path for transpiled inputs.
  if (script.source === file.sourceText || (!script.source && !/\.[cm]?tsx?$/i.test(file.filePath))) {
    return { available: true, quality: { mappingMode: "ast", precision: script.source ? "exact" : "approximate", diagnostics: script.source ? [] : ["SCRIPT_SOURCE_UNVERIFIED"] }, count: (location) => countAt(script, anchor(location)) };
  }
  if (!consumer || !script.source) return unavailable("SOURCE_MAP_MISSING_OR_GENERATED_SOURCE_UNAVAILABLE");
  const source = consumer.sources.find((name) => canonicalPath(name, prepared.mapDirectory) === canonicalPath(file.filePath));
  if (!source) return unavailable("SOURCE_NOT_IN_MAP", "source-map");
  const original = consumer.sourceContentFor(source, true);
  if (original !== null && hash(original) !== file.sourceHash) return unavailable("SOURCE_HASH_MISMATCH", "source-map");
  const sourceOffsets = lineOffsets(file.sourceText ?? "");
  const generatedOffsets = lineOffsets(script.source);
  const points: Point[] = [];
  consumer.eachMapping((mapping) => {
    if (mapping.source !== source || mapping.originalLine === null || mapping.originalColumn === null) return;
    const originalLine = sourceOffsets[mapping.originalLine - 1];
    const generatedLine = generatedOffsets[mapping.generatedLine - 1];
    if (originalLine !== undefined && generatedLine !== undefined) points.push({ original: originalLine + mapping.originalColumn, generated: generatedLine + mapping.generatedColumn });
  });
  points.sort((a, b) => a.original - b.original || a.generated - b.generated);
  const quality: CoverageQuality = { mappingMode: "source-map", precision: "approximate", diagnostics: ["SOURCE_MAP_TOKEN_GRANULARITY", ...(original === null ? ["SOURCE_CONTENT_UNVERIFIED"] : [])] };
  if (!points.length) return unavailable("SOURCE_MAP_HAS_NO_SEGMENTS", "source-map");
  return { available: true, quality, count(location) {
    const start = anchor(location);
    const end = location.end.offset ?? start;
    const point = points.find((item) => item.original >= start && item.original < end);
    if (!point) { if (!quality.diagnostics.includes("LOCATION_NOT_MAPPED")) quality.diagnostics.push("LOCATION_NOT_MAPPED"); return 0; }
    // Multiple generated copies of the same original token are unioned, not summed.
    return Math.max(...points.filter((item) => item.original === point.original).map((item) => countAt(script, item.generated)));
  } };
}
