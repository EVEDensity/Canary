import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ProjectContext, RunSnapshot } from "@canary/core";
import { profileEndpoint, type ExportProfile, type ExportTransport } from "@canary/exporter-core";
import { FileArtifactRepository, redactRunSnapshot } from "@canary/trace";

export type ExportFormat = "json" | "ndjson";
export interface ExportOptions {
  format?: ExportFormat;
  runIds?: string[];
  maxRuns?: number;
  maxStringLength?: number;
}
export interface ExportManifest {
  v: 1;
  kind: "canary.export";
  createdAt: string;
  projectRootHash: string;
  artifactRootHash: string;
  format: ExportFormat;
  runCount: number;
  runIds: string[];
  redaction: { rawInputs: false; rawOutputs: false; rawTrajectory: false; maxStringLength: number };
}

const hashText = (value: string): string => createHash("sha256").update(value).digest("hex");
const safeRunId = (value: string): boolean => /^[A-Za-z0-9._-]{1,160}$/.test(value);

export function buildExport(
  context: ProjectContext,
  options: ExportOptions = {},
): { manifest: ExportManifest; runs: RunSnapshot[] } {
  const format = options.format ?? "json";
  const maxRuns = options.maxRuns ?? 100;
  const maxStringLength = options.maxStringLength ?? 1024;
  if (!Number.isInteger(maxRuns) || maxRuns < 1 || maxRuns > 1000) throw new Error("maxRuns must be 1..1000");
  if (!Number.isInteger(maxStringLength) || maxStringLength < 64 || maxStringLength > 8192)
    throw new Error("maxStringLength must be 64..8192");
  const repository = new FileArtifactRepository(context.artifactRoot);
  let runs = repository.listRuns();
  if (options.runIds) {
    if (options.runIds.length > maxRuns || options.runIds.some((id) => !safeRunId(id)))
      throw new Error("Invalid export run ID");
    runs = options.runIds.map((id) => repository.readRun(id)).filter((run): run is RunSnapshot => Boolean(run));
  }
  runs = runs.slice(0, maxRuns).map((run) => {
    const redacted = redactRunSnapshot(run, { maxStringLength });
    return {
      ...redacted,
      results: redacted.results.map(({ input: _input, output: _output, trajectory: _trajectory, sourceCase: _sourceCase, ...result }) => result),
      events: redacted.events.map((event) => {
        if (!event || typeof event !== "object") return event;
        const { input: _input, output: _output, prompt: _prompt, trajectory: _trajectory, holdout: _holdout, source: _source, diff: _diff, path: _path, ...safe } = event as Record<string, unknown>;
        return safe;
      }),
    } as RunSnapshot;
  });
  const manifest: ExportManifest = {
    v: 1,
    kind: "canary.export",
    createdAt: new Date().toISOString(),
    projectRootHash: hashText(resolve(context.projectRoot)),
    artifactRootHash: hashText(resolve(context.artifactRoot)),
    format,
    runCount: runs.length,
    runIds: runs.map((run) => run.runId),
    redaction: { rawInputs: false, rawOutputs: false, rawTrajectory: false, maxStringLength },
  };
  return { manifest, runs };
}

export function serializeExport(value: ReturnType<typeof buildExport>): string {
  if (value.manifest.format === "ndjson")
    return (
      [
        JSON.stringify({ type: "manifest", ...value.manifest }),
        ...value.runs.map((run) => JSON.stringify({ type: "run", run })),
      ].join("\n") + "\n"
    );
  return JSON.stringify(value, null, 2) + "\n";
}

export function writeExport(context: ProjectContext, output: string, options: ExportOptions = {}): ExportManifest {
  if (!output || output.includes("\0")) throw new Error("Invalid export output");
  const destination = resolve(c