import type { CoverageSummary, EvalResult, RunSnapshot, TestCase } from "./types.js";

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export interface ArtifactRepository {
  readonly rootDir: string;
  listRuns(): RunSnapshot[];
  readRun(runId: string): RunSnapshot | undefined;
  readCoverage(runId: string): CoverageSummary | undefined;
  readJson<T>(runId: string, name: string): T | undefined;
  writeJson(runId: string, name: string, value: unknown): void;
}

export interface EventSink {
  append(event: unknown): void | Promise<void>;
  flush?(): Promise<void>;
  close?(): Promise<void>;
}

export interface CaseExecutor {
  execute(input: { runId: string; cwd: string; testCase: TestCase; signal?: AbortSignal }): Promise<EvalResult>;
}
