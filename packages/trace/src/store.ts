import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import type { ArtifactRepository, CoverageSummary, EvalResult, EventSink, RunSnapshot, Trajectory, TrajectoryEvent } from "@canary/core";
import { parseCoverageSummary, parseRunSnapshot } from "@canary/core";
import { redactValue, type RedactionOptions } from "./privacy.js";
import { ArtifactIntegrityError, safeArtifactPath, updateArtifact, verifyArtifacts } from "./artifacts.js";
export { redactValue, type RedactionOptions } from "./privacy.js";

export const TRACE_SCHEMA_VERSION = 1;

export function redactEvent(event: TrajectoryEvent, options: RedactionOptions = {}): TrajectoryEvent {
  return redactValue(event, options) as TrajectoryEvent;
}

export function redactTrajectory(trajectory: Trajectory, options: RedactionOptions = {}): Trajectory {
  return { ...trajectory, events: trajectory.events.map((event) => redactEvent(event, options)) };
}

export function redactEvalResult(result: EvalResult, options: RedactionOptions = {}): EvalResult {
  return redactValue({
    ...result,
    input: result.input,
    output: result.output,
    trajectory: result.trajectory ? redactTrajectory(result.trajectory, options) : undefined,
  }, options) as EvalResult;
}

export function redactRunSnapshot(snapshot: RunSnapshot, options: RedactionOptions = {}): RunSnapshot {
  return redactValue(snapshot, options) as RunSnapshot;
}

export function queryEvents(events: TrajectoryEvent[], filter: { type?: string; featureId?: string } = {}): TrajectoryEvent[] {
  return events.filter((event) => {
    if (filter.type && event.type !== filter.type && !event.type.endsWith(`.${filter.type}`)) return false;
    if (filter.featureId && String(event.featureId ?? "") !== filter.featureId) return false;
    return true;
  });
}

/** Skip truncated/corrupt trailing lines; do not invent a completed event. */
export function readJsonl(filePath: string): unknown[] {
  if (!existsSync(filePath)) return [];
  const rows: unknown[] = [];
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); }
    catch { /* incomplete write; keep prior complete events */ }
  }
  return rows;
}

export class TraceBuffer {
  readonly events: TrajectoryEvent[] = [];
  emit(event: TrajectoryEvent): void { this.events.push(event); }
}

/** Sync JSONL writer kept for compatibility. Prefer enqueue/flush for backpressure. */
export class JsonlTraceStore implements EventSink {
  constructor(private readonly filePath: string, private readonly options: RedactionOptions = {}) {}
  append(event: unknown): void {
    appendFileSync(this.filePath, `${JSON.stringify(redactValue({ v: TRACE_SCHEMA_VERSION, ...asRecord(event) }, this.options))}\n`, "utf8");
  }
  async flush(): Promise<void> { /* sync writer is already durable */ }
  async close(): Promise<void> { await this.flush(); }
}

export class AsyncJsonlTraceStore implements EventSink {
  private readonly queue: string[] = [];
  private chain = Promise.resolve();
  private closed = false;
  constructor(
    private readonly filePath: string,
    private readonly options: RedactionOptions & { maxQueue?: number } = {},
  ) {}

  async append(event: unknown): Promise<void> {
    if (this.closed) throw new Error("trace store is closed");
    const line = `${JSON.stringify(redactValue({ v: TRACE_SCHEMA_VERSION, ...asRecord(event) }, this.options))}\n`;
    const maxQueue = this.options.maxQueue ?? 256;
    while (this.queue.length >= maxQueue) await this.drain();
    this.queue.push(line);
    this.chain = this.chain.then(() => this.drain());
    return this.chain;
  }

  async flush(): Promise<void> {
    this.chain = this.chain.then(() => this.drain());
    await this.chain;
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.flush();
  }

  private async drain(): Promise<void> {
    if (!this.queue.length) return;
    const batch = this.queue.splice(0).join("");
    await appendFile(this.filePath, batch, "utf8");
  }
}

export class FileArtifactRepository implements ArtifactRepository {
  constructor(public readonly rootDir: string) {}
  verify(runId: string) { return verifyArtifacts(safeArtifactPath(this.rootDir, runId)); }
  private checkedDir(runId: string): string {
    const dir = safeArtifactPath(this.rootDir, runId);
    const result = verifyArtifacts(dir);
    if (result.status === "invalid") throw new ArtifactIntegrityError(result);
    return dir;
  }
  listRuns(): RunSnapshot[] {
    if (!existsSync(this.rootDir)) return [];
    return readdirSync(this.rootDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => {
      try { return this.readRun(entry.name); }
      catch { return undefined; }
    }).filter((run): run is RunSnapshot => Boolean(run)).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  readRun(runId: string): RunSnapshot | undefined {
    const file = safeArtifactPath(this.checkedDir(runId), "run.json");
    if (!existsSync(file)) return undefined;
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(file, "utf8")); }
    catch (error) { throw new Error(`run.json (${runId}): ${error instanceof Error ? error.message : String(error)}`); }
    return redactRunSnapshot(parseRunSnapshot(raw, `run.json (${runId})`) as RunSnapshot);
  }
  readCoverage(runId: string): CoverageSummary | undefined {
    const file = safeArtifactPath(this.checkedDir(runId), "coverage.json");
    if (!existsSync(file)) return undefined;
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(file, "utf8")); }
    catch (error) { throw new Error(`coverage.json (${runId}): ${error instanceof Error ? error.message : String(error)}`); }
    return redactValue(parseCoverageSummary(raw, `coverage.json (${runId})`)) as CoverageSummary;
  }
  readJson<T>(runId: string, name: string): T | undefined {
    const file = safeArtifactPath(this.checkedDir(runId), name);
    if (!existsSync(file)) return undefined;
    try { return redactValue(JSON.parse(readFileSync(file, "utf8"))) as T; } catch { return undefined; }
  }
  writeJson(runId: string, name: string, value: unknown): void {
    updateArtifact(safeArtifactPath(this.rootDir, runId), name, value);
  }
}

function asRecord(event: unknown): Record<string, unknown> {
  return event && typeof event === "object" ? event as Record<string, unknown> : { value: event };
}
