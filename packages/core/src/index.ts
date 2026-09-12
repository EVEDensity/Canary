/** Public contracts for Canary's local Agent evaluation runtime. */

export type AgentAdapterKind = "function" | "http" | "mcp";
export type CoverageStatus = "provisional" | "final" | "partial" | "unavailable";
export type CoverageMappingMode = "source-map" | "ast" | "heuristic";
export type CoveragePrecision = "exact" | "approximate" | "unknown";
export type FeatureCoverageStatus = "covered" | "partial" | "uncovered" | "unavailable" | "failed";
export type ExecutionTermination = "completed" | "timeout" | "cancelled" | "budget_exceeded" | "error" | "loop_detected";

export interface SourcePosition { line: number; column: number; offset?: number }
export interface SourceRange { start: SourcePosition; end: SourcePosition }
export interface SourceLocation extends SourceRange { id?: string; filePath: string; symbol?: string }
export interface CoverageQuality { mappingMode: CoverageMappingMode; precision: CoveragePrecision; diagnostics: string[] }

export interface CanaryConfig {
  agent: { adapter: AgentAdapterKind; entry: string; export?: string };
  cases: string | string[];
  coverage: { include: string[]; exclude?: string[]; lines?: number; branches?: number; functions?: number };
  features?: FeatureDefinition[];
  runtime?: { timeoutMs?: number; maxSteps?: number; maxToolCalls?: number; maxBudget?: number };
  web?: { enabled?: boolean; host?: string; port?: number; open?: boolean };
}

export interface SchemaLike {
  safeParse?: (value: unknown) => { success: boolean; error?: unknown };
  parse?: (value: unknown) => unknown;
}
export type OutputPredicate = (output: unknown, context: { testCase: TestCase; trajectory?: Trajectory }) => boolean | Promise<boolean>;

export type AssertionSpec =
  | { type: "output.exists"; id?: string }
  | { type: "output.schema"; id?: string; schema: SchemaLike }
  | { type: "output.predicate"; id?: string; predicate: OutputPredicate; message?: string }
  | { type: "trajectory.required_event"; id?: string; event: string; minCount?: number }
  | { type: "trajectory.forbidden_event"; id?: string; event: string }
  | { type: "trajectory.max_steps"; id?: string; max: number }
  | { type: "trajectory.max_tool_calls"; id?: string; max: number }
  | { type: "execution.termination"; id?: string; expected: ExecutionTermination }
  | { type: "trajectory.error_recovery"; id?: string; errorEvent?: string; recoveryEvent?: string }
  | { type: "execution.max_latency"; id?: string; maxMs: number }
  | { type: "execution.max_budget"; id?: string; max: number }
  | { type: "feature.expected"; id?: string; featureId: string }
  | { type: string; id?: string; [key: string]: unknown };

export interface TestCase {
  id: string;
  input: unknown;
  expectedFeatures?: string[];
  assertions?: AssertionSpec[];
  options?: { timeoutMs?: number; maxSteps?: number; maxToolCalls?: number; maxBudget?: number };
}

export interface TrajectoryEvent { type: string; timestamp: string; [key: string]: unknown }
export interface Trajectory {
  id: string;
  runId: string;
  caseId: string;
  events: TrajectoryEvent[];
  stepCount: number;
  termination: ExecutionTermination;
}

export interface CoverageMetric { covered: number; total: number; pct: number }
export interface CoverageFile {
  filePath: string;
  sourceHash: string;
  status: CoverageStatus;
  quality?: CoverageQuality;
  lines: CoverageMetric;
  statements: CoverageMetric;
  functions: CoverageMetric;
  branches: CoverageMetric;
  uncoveredLocations: SourceLocation[];
  executableLineNumbers?: number[];
  coveredLineNumbers?: number[];
  coveredStatementIds?: string[];
  coveredFunctionIds?: string[];
  coveredBranchIds?: string[];
}

export interface FeatureDefinition {
  id: string;
  name?: string;
  description?: string;
  files: string[];
  lines?: Array<{ start: number; end: number }>;
  tags?: string[];
}
export interface FeatureCoverage {
  featureId: string;
  name: string;
  status: FeatureCoverageStatus;
  caseIds: string[];
  expectedCaseIds: string[];
  failedCaseIds: string[];
  filePaths: string[];
  coverage: CoverageMetric;
  uncoveredLocations: SourceLocation[];
}

export interface CoverageManifestLocation extends SourceLocation { kind: "statement" | "function" | "branch"; executionStart?: SourcePosition; implicitElseOf?: SourceLocation; branchType?: "if" | "conditional" | "switch" | "logical"; branchIndex?: number }
export interface CoverageManifestFile {
  filePath: string;
  sourceHash: string;
  sourceText?: string;
  executableLines: number[];
  statementLocations: CoverageManifestLocation[];
  functionLocations: CoverageManifestLocation[];
  branchLocations: CoverageManifestLocation[];
  quality: CoverageQuality;
}
export interface CoverageManifest {
  sourceHash: string;
  rootDir: string;
  include: string[];
  exclude: string[];
  files: CoverageManifestFile[];
  features: FeatureDefinition[];
}

export interface CoverageRange { startOffset: number; endOffset: number; count: number }
export interface CoverageFunction { functionName: string; ranges: CoverageRange[] }
export interface CoverageScript { scriptId?: string; url: string; source?: string; sourceMap?: string; sourceMapUrl?: string; functions: CoverageFunction[] }
export interface CoverageFragment {
  runId: string;
  executionId: string;
  provider: "node-v8";
  sourceHash: string;
  capturedAt: string;
  scripts: CoverageScript[];
  status: "final" | "partial" | "unavailable";
  reason?: string;
}
export interface CoverageProvider { readonly id: "node-v8"; start(): Promise<void>; sample(): Promise<CoverageFragment>; stop(): Promise<CoverageFragment> }

export interface CoverageSummary {
  runId: string;
  sourceHash: string;
  status: CoverageStatus;
  lines: CoverageMetric;
  statements: CoverageMetric;
  functions: CoverageMetric;
  branches: CoverageMetric;
  files?: CoverageFile[];
  featureChains: FeatureCoverage[];
}

export interface EvalResult {
  runId: string;
  executionId: string;
  caseId: string;
  passed: boolean;
  assertions: Array<{ id: string; passed: boolean; message?: string; details?: unknown }>;
  coverage: CoverageSummary;
  output?: unknown;
  metrics?: { latencyMs: number; steps: number; toolCalls: number; budgetUsed?: number };
  failureCategory?: string;
  trajectoryId?: string;
  createdAt?: string;
}

/** A small registry intentionally kept in core so config, runner and UI share one identity source. */
export class FeatureRegistry {
  private readonly byId = new Map<string, FeatureDefinition>();
  constructor(features: FeatureDefinition[] = []) { for (const feature of features) this.register(feature); }
  register(feature: FeatureDefinition): void {
    if (!feature.id.trim()) throw new Error("Feature id must not be empty");
    if (!feature.files.length) throw new Error(`Feature ${feature.id} must declare at least one file scope`);
    if (this.byId.has(feature.id)) throw new Error(`Duplicate feature id: ${feature.id}`);
    this.byId.set(feature.id, { ...feature, files: [...feature.files], lines: feature.lines?.map((line) => ({ ...line })), tags: feature.tags ? [...feature.tags] : undefined });
  }
  get(id: string): FeatureDefinition | undefined { return this.byId.get(id); }
  list(): FeatureDefinition[] { return [...this.byId.values()]; }
  validateExpectedFeatures(featureIds: readonly string[] = []): string[] { return featureIds.filter((id) => !this.byId.has(id)); }
}

export function defineConfig(config: CanaryConfig): CanaryConfig { return config; }
