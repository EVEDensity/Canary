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

export type CoverageStatus = "provisional" | "final" | "partial" | "unavailable";

export interface SourceLocation { filePath: string; line: number; column?: number; symbol?: string }
export interface CoverageFile {
  filePath: string; sourceHash: string; status: CoverageStatus;
  lines: CoverageMetric; statements: CoverageMetric; functions: CoverageMetric; branches: CoverageMetric;
  uncoveredLocations: SourceLocation[];
}
export interface FeatureDefinition { id: string; name?: string; files: string[]; lines?: Array<{ start: number; end: number }> }
export interface FeatureCoverage { featureId: string; name: string; caseIds: string[]; filePaths: string[]; coverage: CoverageMetric; uncoveredLocations: SourceLocation[] }
export interface CoverageManifestFile { filePath: string; sourceHash: string; sourceText?: string; executableLines: number[]; statementLocations: SourceLocation[]; functionLocations: SourceLocation[]; branchLocations: SourceLocation[] }
export interface CoverageManifest { sourceHash: string; rootDir: string; include: string[]; exclude: string[]; files: CoverageManifestFile[]; features: FeatureDefinition[] }
export interface CoverageRange { startOffset: number; endOffset: number; count: number }
export interface CoverageFunction { functionName: string; ranges: CoverageRange[] }
export interface CoverageScript { url: string; functions: CoverageFunction[] }
export interface CoverageFragment { runId: string; executionId: string; provider: "node-v8"; sourceHash: string; capturedAt: string; scripts: CoverageScript[]; status: "final" | "partial" | "unavailable"; reason?: string }
export interface CoverageProvider { readonly id: "node-v8"; start(): Promise<void>; sample(): Promise<CoverageFragment>; stop(): Promise<CoverageFragment> }

export interface CoverageSummary {
  runId: string;
  sourceHash: string;
  status: "provisional" | "final" | "partial" | "unavailable";
  lines: CoverageMetric;
  statements: CoverageMetric;
  functions: CoverageMetric;
  branches: CoverageMetric;
  featureChains: FeatureCoverage[];
}

export interface EvalResult {
  runId: string;
  executionId: string;
  caseId: string;
  passed: boolean;
  assertions: Array<{ id: string; passed: boolean; message?: string }>;
  coverage: CoverageSummary;
  metrics?: { latencyMs: number; steps: number; toolCalls: number };
  failureCategory?: string;
  trajectoryId?: string;
  createdAt?: string;
}

export function defineConfig(config: CanaryConfig): CanaryConfig { return config; }
