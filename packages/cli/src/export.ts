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
      throw new Error("Inva