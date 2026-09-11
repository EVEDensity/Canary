/** Public configuration and domain contracts for canary. */
export type AgentAdapterKind = "function" | "http" | "mcp";

export interface CanaryConfig {
  agent: { adapter: AgentAdapterKind; entry: string; export?: string };
  cases: string;
  coverage: { include: string[]; exclude?: string[]; lines?: number; branches?: number; functions?: number };
  web?: { enabled?: boolean; host?: string; port?: number; open?: boolean };
}

export interface TestCase {
  id: string;
  input: unknown;
  expectedFeatures?: string[];
  assertions?: AssertionSpec[];
}

export interface AssertionSpec { type: string; [key: string]: unknown }

export interface TrajectoryEvent { type: string; timestamp: string; [key: string]: unknown }

export interface Trajectory {
  id: string;
  runId: string;
  caseId: string;
  events: TrajectoryEvent[];
  stepCount: number;
  termination: "completed" | "timeout" | "budget_exceeded" | "error" | "loop_detected";
}

export interface CoverageMetric { covered: number; total: number; pct: number }
export interface CoverageSummary {
  runId: string;
  sourceHash: string;
  status: "provisional" | "final" | "partial" | "unavailable";
  lines: CoverageMetric;
  statements: CoverageMetric;
  functions: CoverageMetric;
  branches: CoverageMetric;
  featureChains: Array<{ featureId: string; name: string; coverage: CoverageMetric }>;
}

export interface EvalResult {
  runId: string;
  executionId: string;
  caseId: string;
  passed: boolean;
  assertions: Array<{ id: string; passed: boolean; message?: string }>;
  coverage: CoverageSummary;
}

export function defineConfig(config: CanaryConfig): CanaryConfig { return config; }
