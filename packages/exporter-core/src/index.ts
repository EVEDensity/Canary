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
    executionId: s