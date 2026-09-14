export type ExportProfile = "otlp" | "phoenix" | "langfuse";
export interface ExportEvent {
  v: 1;
  kind: "canary.run";
  profile: ExportProfile;
  runId: string;
  caseId: string;
  executionId: string;
  evaluator: { ids: string[]; passed: number; total: number };
  result: { passed: boolean; latencyMs?: number; steps?: number; toolCalls?: number; failureCategory?: string };
  coverage: { status: string; lines?: number; branches?: number; functions?: number; statements?: number };
  attributes: Record<string, string | number | boolean>;
}
export interface ExportBatch {
  v: 1;
  resource: { serviceName: "canary"; schema: "canary.export.v1" };
  events: ExportEvent[];
}
export interface ExportTransport {
  send(batch: ExportBatch, signal: AbortSignal): Promise<void>;
}
export interface ExportOptions {
  profile: ExportProfile;
  maxQueue?: number;
  maxBatch?: number;
  maxBytes?: number;
  ratePerSecond?: number;
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
}
export interface ExportHealth {
  state: "disabled" | "idle" | "draining" | "degraded";
  queued: number;
  sent: number;
  failed: number;
  dropped: number;
  lastError?: string;
}

const SECRET =
  /api[_-]?key|token|password|secret|authorization|cookie|prompt|completion|input|output|trajectory|holdout|source|diff|path/i;
const CONTENT = /^(?:https?:\/\/|file:\/\/)/i;
export function sanitizeAttributes(input: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (SECRET.test(key) || value === undefined || value === null) continue;
    if (typeof value === "string") {
      if (SECRET.test(value) || CONTENT.test(value)) continue;
      if (value.length <= 256) out[key] = value;
    } else if (typeof value === "number" || typeof value === "boolean") out[key] = value;
  }
  return out;
}
export function eventFromResult(
  profile: ExportProfile,
  runId: string,
  result: {
    caseId: string;
    executionId: string;
    passed: boolean;
    assertions?: Array<{ id?: string; passed?: boolean }>;
    metrics?: { latencyMs?: number; steps?: number; toolCalls?: number };
    coverage?: { status?: string; lines?: number; branches?: number; functions?: number; statements?: number };
    failureCategory?: string;
  },
): ExportEvent {
  const assertions = result.assertions ?? [];
  return {
    v: 1,
    kind: "canary.run",
    profile,
    runId,
    caseId: result.caseId,
    executionId: result.executionId,
    evaluator: {
      ids: assertions.map((a) => a.id ?? "unknown").filter(Boolean),
      passed: assertions.filter((a) => a.passed === true).length,
      total: assertions.length,
    },
    result: {
      passed: result.passed,
      latencyMs: result.metrics?.latencyMs,
      steps: result.metrics?.steps,
      toolCalls: result.metrics?.toolCalls,
      failureCategory: result.failureCategory,
    },
    coverage: {
      status: result.coverage?.status ?? "unavailable",
      lines: result.coverage?.lines,
      branches: result.coverage?.branches,
      functions: result.coverage?.functions,
      statements: result.coverage?.statements,
    },
    attributes: sanitizeAttributes({
      "canary.run.id": runId,
      "canary.case.id": result.caseId,
      "canary.execution.id": result.executionId,
      "canary.result.passed": result.passed,
    }),
  };
}
export class BoundedExporter {
  private readonly queue: ExportEvent[] = [];
  private draining: Promise<void> | undefined;
  private closed = false;
  private lastSent = 0;
  private healthState: ExportHealth = { state: "idle", queued: 0, sent: 0, failed: 0, dropped: 0 };
  private readonly options: Required<ExportOptions>;
  constructor(
    private readonly transport: ExportTransport,
    options: ExportOptions,
  ) {
    this.options = {
      maxQueue: 256,
      maxBatch: 16,
      maxBytes: 64 * 1024,
      ratePerSecond: 10,
      timeoutMs: 3000,
      retries: 2,
      backoffMs: 100,
      ...options,
    };
    if (
      this.options.maxQueue < 1 ||
      this.options.maxBatch < 1 ||
      this.options.maxBatch > this.options.maxQueue ||
      this.options.maxBytes < 1024 ||
      this.options.ratePerSecond <= 0
    )
      throw new Error("Invalid exporter limits");
  }
  health(): ExportHealth {
    return { ...this.healthState, queued: this.queue.length };
  }
  enqueue(event: ExportEvent): boolean {
    if (this.closed || this.queue.length >= this.options.maxQueue) {
      this.healthState.dropped++;
      return false;
    }
    this.queue.push(event);
    this.healthState.queued = this.queue.length;
    void this.drain();
    return true;
  }
  async flush(deadlineMs = 5000): Promise<ExportHealth> {
    if (this.closed) return this.health();
    this.healthState.state = "draining";
    const until = Date.now() + deadlineMs;
    while (this.queue.length && Date.now() < until) {
      await this.drain();
      if (this.queue.length) await new Promise((r) => setTimeout(r, Math.min(25, until - Date.now())));
    }
    this.healthState.state = this.queue.length ? "degraded" : this.healthState.failed ? "degraded" : "idle";
    return this.health();
  }
  async close(deadlineMs = 5000): Promise<ExportHealth> {
    const result = await this.flush(deadlineMs);
    this.closed = true;
    return result;
  }
  private async drain(): Promise<void> {
    if (this.draining || this.closed || !this.queue.length) { if (this.draining) await this.draining; return; }
    this.draining = this.drainOne().finally(() => {
      this.draining = undefined;
      if (this.queue.length && !this.closed) void this.drain();
    });
    await this.draining;
  }
  private async drainOne(): Promise<void> {
    const wait = Math.max(0, 1000 / this.options.ratePerSecond - (Date.now() - this.lastSent));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    const events: ExportEvent[] = [];
    while (events.length < this.options.maxBatch && this.queue.length) {
      const candidate = this.queue[0]!;
      const size = Buffer.byteLength(JSON.stringify(candidate));
      if (events.length && Buffe