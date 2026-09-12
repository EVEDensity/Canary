import { randomUUID } from "node:crypto";

export interface EnvironmentSnapshot { id: string; state: Record<string, unknown> }
export interface StateStore {
  get(key?: string): unknown;
  set(key: string, value: unknown): void;
  snapshot(): EnvironmentSnapshot;
  restore(id: string): void;
  reset(initial?: Record<string, unknown>): void;
}
export interface ToolHandle { call(name: string, args: unknown): Promise<unknown>; close(): Promise<void> }
export interface ToolEnvironment {
  snapshot(): Promise<EnvironmentSnapshot>;
  restore(id: string): Promise<void>;
  reset(): Promise<void>;
  close(): Promise<void>;
}

function clone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
}

export class MemoryStateStore implements StateStore {
  private current: Record<string, unknown>;
  private readonly snapshots = new Map<string, Record<string, unknown>>();
  constructor(initial: Record<string, unknown> = {}) {
    this.current = clone(initial);
  }
  get(key?: string): unknown {
    if (key === undefined) return clone(this.current);
    return this.current[key];
  }
  set(key: string, value: unknown): void {
    this.current[key] = value;
  }
  snapshot(): EnvironmentSnapshot {
    const id = `snap_${randomUUID()}`;
    const state = clone(this.current);
    this.snapshots.set(id, state);
    return { id, state };
  }
  restore(id: string): void {
    const state = this.snapshots.get(id);
    if (!state) throw new Error(`Unknown snapshot: ${id}`);
    this.current = clone(state);
  }
  reset(initial: Record<string, unknown> = {}): void {
    this.current = clone(initial);
  }
}

export class ExecutionEnvironment implements ToolEnvironment {
  constructor(
    public readonly tools: ToolHandle,
    public readonly state: MemoryStateStore,
    private readonly initial: Record<string, unknown> = {},
  ) {}
  async snapshot(): Promise<EnvironmentSnapshot> { return this.state.snapshot(); }
  async restore(id: string): Promise<void> { this.state.restore(id); }
  async reset(): Promise<void> { this.state.reset(this.initial); }
  async close(): Promise<void> { await this.tools.close(); }
}
