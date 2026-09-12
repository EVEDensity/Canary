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
  const artifacts = artifactRoot ? new FileArtifactRepository(resolve(artifactRoot)) : undefined;
  const server = createServer((request: IncomingMessage, response: ServerResponse<IncomingMessage>) => {
    void handleRequest(store, request, response, hooks, artifacts);
  });
  return {
    server,
    listen: () => new Promise<{ url: string; port: number }>((resolveListen, rejectListen) => {
      const onError = (error: NodeJS.ErrnoException): void => {
        if (error.code === "EADDRINUSE") rejectListen(new Error(`Port ${port} is already in use`));
        else rejectListen(error);
      };
      server.once("error", onError);
      server.listen(port, host, () => {
        server.off("error", onError);
        const address = server.address();
        const actualPort = typeof address === "object" && address ? address.port : port;
        resolveListen({ url: `http://${host}:${actualPort}`, port: actualPort });
      });
    }),
  };
}

async function handleRequest(store: RunStore, request: IncomingMessage, response: ServerResponse<IncomingMessage>, hooks?: WebServerHooks, artifacts?: FileArtifactRepository): Promise<void> {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const parts = url.pathname.split("/").filter(Boolean);
    response.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1");
    if (url.pathname === "/logo.png" || url.pathname === "/favicon.ico") {
      const logoPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../docs/images/logo.png");
      if (existsSync(logoPath)) {
        const buf = readFileSync(logoPath);
        response.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=86400" });
        response.end(buf);
        return;
      }
      response.writeHead(404); response.end("Not found");
      return;
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const runId = url.searchParams.get("runId");
      const run = runId ? store.get(runId) : undefined;
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(renderPage(run, { writeToken: hooks?.writeToken }));
      return;
    }
    if (parts[0] === "api" && parts[1] === "compare") {
      const baselineId = url.searchParams.get("baseline");
      const candidateId = url.searchParams.get("candidate");
      if (!baselineId || !candidateId) { writeJson(response, 400, { error: "baseline and candidate query parameters are required" }); return; }
      const baseline = store.get(baselineId);
      const candidate = store.get(candidateId);
      if (!baseline || !candidate) { writeJson(response, 404, { error: "Both baseline and candidate runs must exist" }); return; }
      const holdout = holdoutCaseIds([...baseline.results, ...candidate.results]);
      writeJson(response, 200, compareRuns(baseline, candidate, holdout));
      return;
    }
    if (parts[0] === "api" && parts[1] === "runs" && parts.length === 2) {
      writeJson(response, 200, store.list().map((run) => redactRunSnapshot(parseRunSnapshot(run, "GET /api/runs") as typeof run)));
      return;
    }
    if (parts[0] === "api" && parts[1] === "runs" && parts[2]) {
      const runId = parts[2];
      const run = store.get(runId);
      if (!run) { response.writeHead(404); response.end("Not found"); return; }
      if (parts[3] === "events") {
        response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        response.write("retry: 2000\n\n");
        const rawId = request.headers["last-event-id"];
        const lastEventId = rawId === undefined || rawId === "" ? undefined : Number.parseInt(String(rawId), 10);
        const unsubscribe = store.subscribe(runId, response, lastEventId);
        request.on("close", unsubscribe);
        request.on("error", unsubscribe);
        return;
      }
      if (parts[3] === "replay") {
        if (request.method !== "POST") { response.writeHead(405); response.end("Method Not Allowed"); return; }
        if (!allowWrite(request, url, hooks)) { writeJson(response, 403, { error: "Write API requires x-canary-write-token" }); return; }
        const parsed = parseReplayRequest(await readJsonBody(request));
        store.replay(runId);
        const executed = hooks?.onReplay ? await hooks.onReplay(runId, parsed) : undefined;
        writeJson(response, 200, parseReplayResponse({
          sourceRunId: runId,
          command: replayCommand(runId),
          mode: executed?.replayRunId ? "execution" : "command",
          replayRunId: executed?.replayRunId,
          events: store.eventLog(runId).length,
        }));
        return;
      }
      if (parts[3] === "improvements") {
        if (request.method === "POST" && parts[4]) {
          if (!allowWrite(request, url, hooks)) { writeJson(response, 403, { error: "Write API requires x-canary-write-token" }); return; }
          const decision = parseSuggestionDecision(await readJsonBody(request));
          const list = [...((run.improvements ?? []) as ImprovementSuggestion[])];
          const index = list.findIndex((item) => item.id === parts[4]);
          if (index < 0) { writeJson(response, 404, { error: "Suggestion not found" }); return; }
          list[index] = decideSuggestion(list[index]!, decision.status);
          store.update(runId, { improvements: list });
          artifacts?.writeJson(runId, "improvement.json", list);
          if (decision.status === "verified" && artifacts) {
            writeRegressionDrafts(
              list.filter((item) => item.status === "verified"),
              resolveRegressionDir(resolveProjectRootFromArtifacts(artifacts.rootDir)),
            );
          }
          writeJson(response, 200, list[index]);
          return;
        }
        writeJson(response, 200, run.improvements ?? []);
        return;
      }
      if (parts[3] === "coverage") {
        writeJson(response, 200, run.coverage ? parseCoverageSummary(run.coverage, "GET coverage") : null);
        return;
      }
      if (parts[3] === "cases") { writeJson(response, 200, redactValue(run.results)); return; }
      if (parts[3] === "trajectory") {
        const trajectoryId = parts[4];
        const payload = trajectoryId ? run.results.find((result) => result.trajectoryId === trajectoryId || result.trajectory?.id === trajectoryId)?.trajectory : run.results.map((result) => result.trajectory);
        if (!payload) { writeJson(response, 404, { error: "Not found" }); return; }
        writeJson(response, 200, redactValue(payload));
        return;
      }
      if (parts[3] === "report") {
        const format = parseReportFormat(parts[4] ?? "markdown");
        const body = renderReport({ runId: run.runId, status: run.status, startedAt: run.startedAt, finishedAt: run.finishedAt, totalCases: run.totalCases, passedCases: run.passedCases, results: run.results, coverage: run.coverage, gate: run.gate }, format);
        response.writeHead(200, { "content-type": format === "junit" ? "application/xml; charset=utf-8" : format === "json" ? "application/json" : "text/markdown; charset=utf-8" });
        response.end(body);
        return;
      }
      writeJson(response, 200, redactRunSnapshot(parseRunSnapshot(run, "GET /api/runs/:runId") as typeof run));
      return;
    }
    response.writeHead(404); response.end("Not found");
  } catch (error) {
    writeError(response, error);
  }
}
