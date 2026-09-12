import { appendFileSync } from "node:fs";
import type { Trajectory, TrajectoryEvent } from "@canary/core";

export class TraceBuffer {
  readonly events: TrajectoryEvent[] = [];
  emit(event: TrajectoryEvent): void { this.events.push(event); }
}

const SECRET = /api[_-]?key|token|password|secret|authorization|cookie/i;
export interface RedactionOptions { maxStringLength?: number; replacement?: string }

function redactValue(value: unknown, options: RedactionOptions, key?: string): unknown {
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

export function queryEvents(events: TrajectoryEvent[], filter: { type?: string; featureId?: string } = {}): TrajectoryEvent[] {
  return events.filter((event) => {
    if (filter.type && event.type !== filter.type && !event.type.endsWith(`.${filter.type}`)) return false;
    if (filter.featureId && String(event.featureId ?? "") !== filter.featureId) return false;
    return true;
  });
}

export class JsonlTraceStore {
  constructor(private readonly filePath: string, private readonly options: RedactionOptions = {}) {}
  append(event: unknown): void {
    appendFileSync(this.filePath, `${JSON.stringify(redactValue(event, this.options))}\n`, "utf8");
  }
}
