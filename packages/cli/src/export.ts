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

const hashText = (value: string): string => cr