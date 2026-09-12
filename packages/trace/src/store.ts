import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import type { ArtifactRepository, CoverageSummary, EvalResult, EventSink, RunSnapshot, Trajectory, TrajectoryEvent } from "@canary/core";
import { parseCoverageSummary, parseRunSnapshot } from "@canary/core";

export const TRACE_SCHEMA_VERSION = 1;
const SECRET = /api[_-]?key|token|password|secret|authorization|cookie/i;

export interface RedactionOptions { maxStringLength?: number; replacement?: string }

export function redactValue(value: unknown, options: RedactionOptions = {}, key?: string): unknown {
  const replacement = options.replacement ?? "[redacted]";
  const max = options.maxStringLength ?? 2048;
  if (key && SECRET.test(key)) return replacement;
  if (typeof value === "string") {
    if (SECRET.test(value)) return replacement;
    return value.length > max ? `${value.slice(0, max)}…` : value;
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item, options));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, item]) => [name, redactValue(item, options, name)]));
  }
  return value;
}

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
  return {
    ...snapshot,
    results: snapshot.results.map((result) => redactEvalResult(result, options)),
    events: snapshot.events.map((event) => redactValue(event, options) as typeof event),
  };
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
  listRuns(): RunSnapshot[] {
    if (!existsSync(this.rootDir)) return [];
    return readdirSync(this.rootDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => {
      try { return this.readRun(entry.name); }
      catch { return undefined; }
    }).filter((run): run is RunSnapshot => Boolean(run)).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
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

function asRecord(event: unknown): Record<string, unknown> {
  return event && typeof event === "object" ? event as Record<string, unknown> : { value: event };
}
