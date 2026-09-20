import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ArtifactRepository, CoverageGateResult, CoverageSummary, RunnerEvent, RunSnapshot } from "@canary/core";
import { redactValue, type RedactionOptions } from "./store.js";

export interface SseEvent {
  id: number;
  type: string;
  runId: string;
  payload: unknown;
}

export { CANONICAL_SSE_EVENTS } from "@canary/core";
export const SSE_HEARTBEAT_MS = 15_000;

type Subscriber = ServerResponse<IncomingMessage>;

/** In-memory run session. SSE cursor is process-local; artifacts hydrate snapshots, not the same event ids after restart. */
export class RunStore {
  private privacy: RedactionOptions = {};
  setPrivacy(options: RedactionOptions): void { this.privacy = options; }
  sanitize<T>(value: T): T { return redactValue(value, this.privacy) as T; }
  private readonly runs = new Map<string, RunSnapshot>();
  private readonly subscribers = new Map<string, Set<Subscriber>>();
  private readonly coverageFingerprints = new Map<string, string>();
  private readonly sseLog = new Map<string, SseEvent[]>();
  private readonly sseSeq = new Map<string, number>();

  hydrateRun(repository: ArtifactRepository, runId: string): RunSnapshot | undefined {
    if (this.runs.has(runId)) return this.runs.get(runId);
    const run = repository.readRun(runId);
    if (!run) return undefined;
    const coverage = run.coverage ?? repository.readCoverage(runId);
    const improvements = repository.readJson<unknown[]>(runId, "improvement.json");
    const gate = repository.readJson<CoverageGateResult>(runId, "gate.json");
    const snapshot = { ...run, ...(coverage ? { coverage } : {}), ...(Array.isArray(improvements) ? { improvements } : {}), ...(gate ? { gate } : {}) };
    this.runs.set(runId, snapshot);
    this.rebuildSseLog(snapshot);
    return snapshot;
  }

  hydrate(repository: ArtifactRepository, include: (run: RunSnapshot) => boolean = () => true): void {
    for (const run of repository.listRuns()) {
      if (!include(run)) continue;
      if (!this.runs.has(run.runId)) {
        const coverage = run.coverage ?? repository.readCoverage(run.runId);
        const improvements = repository.readJson<unknown[]>(run.runId, "improvement.json");
        const gate = repository.readJson<CoverageGateResult>(run.runId, "gate.json");
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
      response.write(`${idLine}event: ${event.type}\ndata: ${JSON.stringify(this.sanitize(event.payload))}\n\n`);
    } catch { /* client disconnected */ }
  }
}
