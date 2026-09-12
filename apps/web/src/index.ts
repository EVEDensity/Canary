import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CoverageGateResult, CoverageSummary, EvalResult } from "@canary/core";
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
import type { RunnerEvent } from "@canary/runner";
import { renderReport } from "@canary/reporters";
import { compareRuns, decideSuggestion, holdoutCaseIds, writeRegressionDrafts, type ImprovementSuggestion } from "@canary/improvement";
import { renderPage } from "./ui.js";

export interface ArtifactRepository {
  listRuns(): RunSnapshot[];
  readRun(runId: string): RunSnapshot | undefined;
  readCoverage(runId: string): CoverageSummary | undefined;
}

export class FileArtifactRepository implements ArtifactRepository {
  constructor(public readonly rootDir: string) {}
  listRuns(): RunSnapshot[] {
    if (!existsSync(this.rootDir)) return [];
    return readdirSync(this.rootDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => {
      try { return this.readRun(e.name); }
      catch { return undefined; }
    }).filter((r): r is RunSnapshot => Boolean(r)).sort((a,b) => b.startedAt.localeCompare(a.startedAt));
  }
  readRun(runId: string): RunSnapshot | undefined {
    const file = join(this.rootDir, runId, "run.json");
    if (!existsSync(file)) return undefined;
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(file, "utf8")); }
    catch (error) { throw new Error(`run.json (${runId}): ${error instanceof Error ? error.message : String(error)}`); }
    return parseRunSnapshot(raw, `run.json (${runId})`) as RunSnapshot;
  }
  readCoverage(runId: string): CoverageSummary | undefined {
    const file = join(this.rootDir, runId, "coverage.json");
    if (!existsSync(file)) return undefined;
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(file, "utf8")); }
    catch (error) { throw new Error(`coverage.json (${runId}): ${error instanceof Error ? error.message : String(error)}`); }
    return parseCoverageSummary(raw, `coverage.json (${runId})`) as CoverageSummary;
  }
  readJson<T>(runId: string, name: string): T | undefined {
    const file = join(this.rootDir, runId, name);
    if (!existsSync(file)) return undefined;
    try { return JSON.parse(readFileSync(file, "utf8")) as T; } catch { return undefined; }
  }
  writeJson(runId: string, name: string, value: unknown): void {
    const dir = join(this.rootDir, runId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), JSON.stringify(value, null, 2), "utf8");
  }
}

export interface RunSnapshot {
  runId: string;
  status: "idle" | "running" | "completed" | "failed" | "cancelled";
  startedAt: string;
  finishedAt?: string;
  totalCases: number;
  completedCases: number;
  passedCases: number;
  results: EvalResult[];
  coverage?: CoverageSummary;
  events: RunnerEvent[];
  improvements?: unknown[];
  gate?: CoverageGateResult;
  replayOf?: string;
  candidateOf?: string;
}

export interface SseEvent {
  id: number;
  type: string;
  runId: string;
  payload: unknown;
}

export { CANONICAL_SSE_EVENTS } from "@canary/core";
export const SSE_HEARTBEAT_MS = 15_000;

type Subscriber = ServerResponse<IncomingMessage>;

export class RunStore {
  private readonly runs = new Map<string, RunSnapshot>();
  private readonly subscribers = new Map<string, Set<Subscriber>>();
  private readonly coverageFingerprints = new Map<string, string>();
  private readonly sseLog = new Map<string, SseEvent[]>();
  private readonly sseSeq = new Map<string, number>();

  hydrate(repository: ArtifactRepository): void {
    for (const run of repository.listRuns()) {
      if (!this.runs.has(run.runId)) {
        const coverage = run.coverage ?? repository.readCoverage(run.runId);
        const improvements = repository instanceof FileArtifactRepository ? repository.readJson<unknown[]>(run.runId, "improvement.json") : undefined;
        const gate = repository instanceof FileArtifactRepository ? repository.readJson<CoverageGateResult>(run.runId, "gate.json") : undefined;
        this.runs.set(run.runId, { ...run, ...(coverage ? { coverage } : {}), ...(Array.isArray(improvements) ? { improvements } : {}), ...(gate ? { gate } : {}) });
        this.rebuildSseLog(this.runs.get(run.runId)!);
      }
    }
  }

  subscriberCount(runId: string): number { return this.subscribers.get(runId)?.size ?? 0; }
  eventLog(runId: string): SseEvent[] { return [...(this.sseLog.get(runId) ?? [])]; }

  create(totalCases: number, runId = `run_${randomUUID()}`, replayOf?: string): RunSnapshot {
    const snapshot: RunSnapshot = { runId, status: "running", startedAt: new Date().toISOString(), totalCases, completedCases: 0, passedCases: 0, results: [], events: [], ...(replayOf ? { replayOf } : {}) };
    this.runs.set(runId, snapshot);
    this.publish(runId, { type: "run.started", runId, payload: snapshot });
    return snapshot;
  }

  get(runId: string): RunSnapshot | undefined { return this.runs.get(runId); }
  list(): RunSnapshot[] { return [...this.runs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)); }

  update(runId: string, patch: Partial<RunSnapshot>): RunSnapshot {
    const current = this.runs.get(runId);
    if (!current) throw new Error(`Unknown run: ${runId}`);
    const next = { ...current, ...patch };
    this.runs.set(runId, next);
    this.publish(runId, { type: "run.updated", runId, payload: next });
    return next;
  }

  appendEvent(runId: string, event: RunnerEvent): void {
    const current = this.runs.get(runId);
    if (!current) return;
    current.events.push(event);
    if (event.type === "execution.finished") {
      current.completedCases += 1;
      if (event.result.passed) current.passedCases += 1;
      current.results.push(event.result);
    }
    this.publish(runId, { type: event.type, runId, payload: event });
    if (event.type === "execution.started") this.publish(runId, { type: "case.started", runId, payload: event });
    if (event.type === "execution.finished") this.publish(runId, { type: "case.finished", runId, payload: event });
    if (event.type === "execution.failed") this.publish(runId, { type: "run.error", runId, payload: event });
  }

  reportError(runId: string, error: string): void {
    this.publish(runId, { type: "run.error", runId, payload: { error } });
  }

  setCoverage(runId: string, coverage: CoverageSummary): void {
    const current = this.runs.get(runId);
    if (!current) return;
    const fingerprint = this.coverageKey(coverage);
    if (this.coverageFingerprints.get(runId) === fingerprint) return;
    this.coverageFingerprints.set(runId, fingerprint);
    current.coverage = coverage;
    this.publish(runId, { type: "coverage.updated", runId, payload: coverage });
  }

  finish(runId: string, status?: "completed" | "failed" | "cancelled"): RunSnapshot {
    const current = this.runs.get(runId);
    if (!current) throw new Error(`Unknown run: ${runId}`);
    current.status = status ?? (current.results.every((result) => result.passed) ? "completed" : "failed");
    current.finishedAt = new Date().toISOString();
    this.publish(runId, { type: "run.finished", runId, payload: current });
    return current;
  }

  replay(runId: string): RunSnapshot {
    const current = this.get(runId);
    if (!current) throw new Error(`Unknown run: ${runId}`);
    this.publish(runId, { type: "run.replay", runId, payload: current });
    return current;
  }

  subscribe(runId: string, response: Subscriber, lastEventId?: number): () => void {
    const set = this.subscribers.get(runId) ?? new Set<Subscriber>();
    set.add(response);
    this.subscribers.set(runId, set);
    const snapshot = this.get(runId);
    if (snapshot) this.writeEvent(response, { id: 0, type: "run.snapshot", runId, payload: snapshot });
    this.writeHeartbeat(response);
    const heartbeatMs = Number(process.env.CANARY_SSE_HEARTBEAT_MS) || SSE_HEARTBEAT_MS;
    const heartbeat = setInterval(() => this.writeHeartbeat(response), heartbeatMs);
    heartbeat.unref();
    if (lastEventId !== undefined && Number.isFinite(lastEventId)) {
      for (const event of this.sseLog.get(runId) ?? []) {
        if (event.id > lastEventId) this.writeEvent(response, event);
      }
    }
    let active = true;
    const unsubscribe = (): void => {
      if (!active) return;
      active = false;
      clearInterval(heartbeat);
      set.delete(response);
      if (set.size === 0) this.subscribers.delete(runId);
    };
    response.once("close", unsubscribe);
    return unsubscribe;
  }

  private rebuildSseLog(run: RunSnapshot): void {
    const events: SseEvent[] = [];
    let id = 0;
    events.push({ id: ++id, type: "run.started", runId: run.runId, payload: { runId: run.runId, startedAt: run.startedAt } });
    for (const event of run.events) {
      events.push({ id: ++id, type: event.type, runId: run.runId, payload: event });
      if (event.type === "execution.started") events.push({ id: ++id, type: "case.started", runId: run.runId, payload: event });
      if (event.type === "execution.finished") events.push({ id: ++id, type: "case.finished", runId: run.runId, payload: event });
      if (event.type === "execution.failed") events.push({ id: ++id, type: "run.error", runId: run.runId, payload: event });
    }
    if (run.coverage) events.push({ id: ++id, type: "coverage.updated", runId: run.runId, payload: run.coverage });
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") events.push({ id: ++id, type: "run.finished", runId: run.runId, payload: run });
    this.sseLog.set(run.runId, events);
    this.sseSeq.set(run.runId, id);
    if (run.coverage) this.coverageFingerprints.set(run.runId, this.coverageKey(run.coverage));
  }

  private coverageKey(coverage: CoverageSummary): string {
    return JSON.stringify({
      status: coverage.status,
      sourceHash: coverage.sourceHash,
      lines: coverage.lines,
      branches: coverage.branches,
      functions: coverage.functions,
      statements: coverage.statements,
    });
  }

  private publish(runId: string, event: { type: string; runId: string; payload: unknown }): void {
    const id = (this.sseSeq.get(runId) ?? 0) + 1;
    this.sseSeq.set(runId, id);
    const envelope: SseEvent = { id, type: event.type, runId, payload: event.payload };
    const log = this.sseLog.get(runId) ?? [];
    log.push(envelope);
    this.sseLog.set(runId, log);
    for (const response of this.subscribers.get(runId) ?? []) this.writeEvent(response, envelope);
  }

  private writeHeartbeat(response: Subscriber): void {
    if (response.writableEnded || response.destroyed) return;
    try { response.write(": ping\n\n"); } catch { /* client disconnected */ }
  }

  private writeEvent(response: Subscriber, event: SseEvent): void {
    if (response.writableEnded || response.destroyed) return;
    try {
      const idLine = event.id > 0 ? `id: ${event.id}\n` : "";
      response.write(`${idLine}event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
    } catch { /* client disconnected */ }
  }
}

export interface WebServerHooks {
  onReplay?: (runId: string, request: { caseId?: string }) => Promise<{ replayRunId: string }>;
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
  writeJson(response, error instanceof SchemaValidationError ? 400 : 400, { error: message });
}

export function createWebServer(store: RunStore, host = "127.0.0.1", port = 0, artifactRoot?: string, hooks?: WebServerHooks) {
  if (artifactRoot) store.hydrate(new FileArtifactRepository(resolve(artifactRoot)));
  const artifacts = artifactRoot ? new FileArtifactRepository(resolve(artifactRoot)) : undefined;
  const server = createServer((request: IncomingMessage, response: ServerResponse<IncomingMessage>) => {
    void handleRequest(store, request, response, hooks, artifacts);
  });
  return { server, listen: () => new Promise<{ url: string; port: number }>((resolveListen) => server.listen(port, host, () => { const address = server.address(); const actualPort = typeof address === "object" && address ? address.port : port; resolveListen({ url: `http://${host}:${actualPort}`, port: actualPort }); })) };
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
      response.end(renderPage(run));
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
      writeJson(response, 200, store.list().map((run) => parseRunSnapshot(run, "GET /api/runs")));
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
          const decision = parseSuggestionDecision(await readJsonBody(request));
          const list = [...((run.improvements ?? []) as ImprovementSuggestion[])];
          const index = list.findIndex((item) => item.id === parts[4]);
          if (index < 0) { writeJson(response, 404, { error: "Suggestion not found" }); return; }
          list[index] = decideSuggestion(list[index]!, decision.status);
          store.update(runId, { improvements: list });
          artifacts?.writeJson(runId, "improvement.json", list);
          if (decision.status === "verified" && artifacts) {
            const projectRoot = resolve(artifacts.rootDir, "..", "..");
            const regressionDir = existsSync(resolve(projectRoot, "cases/regression"))
              ? resolve(projectRoot, "cases/regression")
              : existsSync(resolve(projectRoot, "examples/local-agent/cases"))
                ? resolve(projectRoot, "examples/local-agent/cases/regression")
                : resolve(projectRoot, "cases/regression");
            writeRegressionDrafts(list.filter((item) => item.status === "verified"), regressionDir);
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
      if (parts[3] === "cases") { writeJson(response, 200, run.results); return; }
      if (parts[3] === "trajectory") {
        const trajectoryId = parts[4];
        const payload = trajectoryId ? run.results.find((result) => result.trajectoryId === trajectoryId || result.trajectory?.id === trajectoryId)?.trajectory : run.results.map((result) => result.trajectory);
        if (!payload) { writeJson(response, 404, { error: "Not found" }); return; }
        writeJson(response, 200, payload);
        return;
      }
      if (parts[3] === "report") {
        const format = parseReportFormat(parts[4] ?? "markdown");
        const body = renderReport({ runId: run.runId, status: run.status, startedAt: run.startedAt, finishedAt: run.finishedAt, totalCases: run.totalCases, passedCases: run.passedCases, results: run.results, coverage: run.coverage, gate: run.gate }, format);
        response.writeHead(200, { "content-type": format === "junit" ? "application/xml; charset=utf-8" : format === "json" ? "application/json" : "text/markdown; charset=utf-8" });
        response.end(body);
        return;
      }
      writeJson(response, 200, parseRunSnapshot(run, "GET /api/runs/:runId"));
      return;
    }
    response.writeHead(404); response.end("Not found");
  } catch (error) {
    writeError(response, error);
  }
}
