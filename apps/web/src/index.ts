import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseCoverageSummary,
  parseReplayRequest,
  parseReplayResponse,
  parseReportFormat,
  parseRunSnapshot,
  parseSuggestionDecision,
  SchemaValidationError,
  invalidInput,
} from "@canary/core";
import { renderReport } from "@canary/reporters";
import { compareRuns, decideSuggestion, holdoutCaseIds, writeRegressionDrafts, type ImprovementSuggestion } from "@canary/improvement";
import { FileArtifactRepository, redactRunSnapshot, redactValue, RunStore } from "@canary/trace";
import { renderPage } from "./ui.js";

export type { RunSnapshot } from "@canary/core";
export { FileArtifactRepository, RunStore, SSE_HEARTBEAT_MS, type SseEvent } from "@canary/trace";
export { CANONICAL_SSE_EVENTS } from "@canary/core";

export interface WebServerHooks {
  onReplay?: (runId: string, request: { caseId?: string }) => Promise<{ replayRunId: string }>;
  /** Required for POST replay/improvements. CORS is not authorization. */
  writeToken?: string;
}

export function replayCommand(runId: string): string {
  return `canary replay ${runId}`;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch { invalidInput("JSON body", "Request body is not valid JSON"); }
}

function writeJson(response: ServerResponse<IncomingMessage>, status: number, payload: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function writeError(response: ServerResponse<IncomingMessage>, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  writeJson(response, 400, { error: message });
}

function resolveProjectRootFromArtifacts(artifactRoot: string): string {
  const normalized = resolve(artifactRoot);
  const parent = resolve(normalized, "..");
  if (basename(parent) === ".canary") return resolve(parent, "..");
  let dir = normalized;
  while (true) {
    if (existsSync(resolve(dir, "canary.config.ts"))) return dir;
    const parentDir = dirname(dir);
    if (parentDir === dir) break;
    dir = parentDir;
  }
  return normalized;
}

function resolveRegressionDir(projectRoot: string): string {
  if (existsSync(resolve(projectRoot, "cases/regression"))) return resolve(projectRoot, "cases/regression");
  if (existsSync(resolve(projectRoot, "examples/local-agent/cases"))) return resolve(projectRoot, "examples/local-agent/cases/regression");
  return resolve(projectRoot, "cases/regression");
}

function requestWriteToken(request: IncomingMessage, url: URL): string | undefined {
  const header = request.headers["x-canary-write-token"];
  if (typeof header === "string" && header) return header;
  const query = url.searchParams.get("token");
  return query || undefined;
}

function allowWrite(request: IncomingMessage, url: URL, hooks?: WebServerHooks): boolean {
  return Boolean(hooks?.writeToken) && requestWriteToken(request, url) === hooks?.writeToken;
}

export function createWebServer(store: RunStore, host = "127.0.0.1", port = 0, artifactRoot?: string, hooks?: WebServerHooks) {
  if (artifactRoot) store.hydrate(new FileArtifactRepository(resolve(artifactRoot)));
  const artifacts = artifactRoot ? new FileArtifactRepository(resolve(artifactR