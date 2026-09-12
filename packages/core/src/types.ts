/** Domain types shared by config, runner, storage, and UI. Mechanical split from the former barrel. */

export type AgentAdapterKind = "function" | "http" | "mcp";
export type CoverageStatus = "preparing" | "provisional" | "final" | "partial" | "unavailable";
export type CoverageMappingMode = "source-map" | "ast" | "heuristic";
export type CoveragePrecision = "exact" | "approximate" | "unknown";
export type FeatureCoverageStatus = "covered" | "partial" | "uncovered" | "unavailable" | "failed";
export type ExecutionTermination = "completed" | "timeout" | "cancelled" | "budget_exceeded" | "error" | "loop_detected";
export type RunStatus = "idle" | "running" | "completed" | "failed" | "cancelled";

export interface SourcePosition { line: number; column: number; offset?: number }
export interface SourceRange { start: SourcePosition; end: SourcePosition }
export interface SourceLocation extends SourceRange { id?: string; filePath: string; symbol?: string }
export interface CoverageQuality { mappingMode: CoverageMappingMode; precision: CoveragePrecision; diagnostics: string[] }

export interface CoverageThresholds {
  lines?: number;
  branches?: number;
  functions?: number;
  statements?: number;
  featureChains?: Record<string, number>;
}

export interface CoverageGateFailure {
  code: "unavailable" | "partial" | "below_threshold" | "feature_unavailable" | "policy_violation" | "loop" | "state_mismatch";
  target: string;
  required?: number;
  actual?: number;
  status?: string;
  message: string;
}

export interface CoverageGateResult {
  passed: boolean;
  reason?: "behavior_passed_coverage_insufficient" | "hard_gate_failed";
  failureCategory?: "coverage_below_threshold" | "policy_violation" | "loop" | "state_mismatch";
  failures: CoverageGateFailure[];
  featureChainSemantics?: {
    mode: "source_pct";
    partialDoesNotFail: true;
  };
  hardGate?: {
    passed: boolean;
    policyViolations: number;
    unexpectedLoops: number;
    stateFailures: number;
    unavailableCoreFeatures: string[];
  };
}

export type ToolAdapterKind = "mock" | "mcp-stdio" | "mcp-http";
export type ModelProviderKind = "deterministic" | "echo";
export interface ModelCompletion { text: string; usage?: { tokens?: number } }
/** Agent-side model calls. Not JudgeProvider — judges live in `@canary/evaluators`. */
export interface ModelProvider {
  readonly kind: ModelProviderKind;
  complete(prompt: string): Promise<ModelCompletion>;
}

export const CANONICAL_SSE_EVENTS = [
  "run.started",
  "case.started",
  "trace.event",
  "coverage.updated",
  "case.finished",
  "run.finished",
  "run.error",
] as const;
export type CanonicalSseEvent = (typeof CANONICAL_SSE_EVENTS)[number];

export interface CanaryToolsConfig {
  adapter: ToolAdapterKind;
  entry?: string;
  export?: string;
  command?: string;
  args?: string[];
  url?: string;
}

export interface CanaryModelConfig {
  provider: ModelProviderKind;
  responses?: Record<string, string>;
}

export interface CanaryJudgeConfig {
  provider: "http" | "deterministic";
  required?: boolean;
  url?: string;
  timeoutMs?: number;
  rubric?: string;
  /** HTTP Judge does not send requests unless this is true. */
  allowOutbound?: boolean;
}

export interface CaseDataset {
  split?: "eval" | "holdout" | "regression";
  version?: string;
  contentHash?: string;
}

export type CoverageProviderKind = "v8" | "istanbul";

export interface CanaryConfig {
  agent: { adapter: AgentAdapterKind; entry: string; export?: string };
  cases: string | string[];
  coverage: { include: string[]; exclude?: string[]; sampleIntervalMs?: number; provider?: CoverageProviderKind } & CoverageThresholds;
  features?: FeatureDefinition[];
  tools?: CanaryToolsConfig;
  model?: CanaryModelConfig;
  judge?: CanaryJudgeConfig;
  runtime?: { timeoutMs?: number; maxSteps?: number; maxToolCalls?: number; maxBudget?: number; repetitions?: number; concurrency?: number };
  reporters?: Array<"json" | "markdown" | "junit" | "console">;
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
  | { type: "coverage.atLeast"; id?: string; featureId: string; minPct: number }
  | { type: "judge.score"; id?: string; minScore?: number; minConfidence?: number; rubric?: string; timeoutMs?: number; required?: boolean }
  | { type: "tool.called"; id?: string; name: string; minCount?: number }
  | { type: "tool.args"; id?: string; name: string; equals?: unknown; contains?: Record<string, unknown> }
  | { type: "tool.order"; id?: string; names: string[] }
  | { type: "state.equals"; id?: string; key?: string; value: unknown }
  | { type: "state.has"; id?: string; key: string }
  | { type: "state.contains"; id?: string; value?: Record<string, unknown>; contains?: Record<string, unknown> }
  | { type: "policy.none"; id?: string }
  | { type: string; id?: string; [key: string]: unknown };

export interface TestCase {
  id: string;
  input: unknown;
  tags?: string[];
  expectedFeatures?: string[];
  assertions?: AssertionSpec[];
  environment?: { state?: Record<string, unknown>; tools?: unknown[] };
  options?: { timeoutMs?: number; maxSteps?: number; maxToolCalls?: number; maxBudget?: number; repetitions?: number };
  dataset?: CaseDataset;
}

/** Original case snapshot attached to EvalResult for drafts and holdout identity. */
export interface SourceCaseSnapshot {
  id: string;
  input: unknown;
  tags?: string[];
  expectedFeatures?: string[];
  assertions?: AssertionSpec[];
  environment?: TestCase["environment"];
  dataset?: CaseDataset;
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
  sourceText?: string;
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
  provider: "node-v8" | "istanbul";
  processId?: number;
  isolateId?: string;
  sequence?: number;
  phase?: "init" | "task" | "final";
  sourceHash: string;
  capturedAt: string;
  scripts: CoverageScript[];
  status: "final" | "partial" | "unavailable";
  reason?: string;
}
export interface CoverageProvider { readonly id: "node-v8" | "istanbul"; start(): Promise<void>; sample(): Promise<CoverageFragment>; stop(): Promise<CoverageFragment> }

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
  /** Module-load sample is captured then V8 counters reset before the agent task. */
  lifecycle?: {
    initCaptured: boolean;
    taskWindow: "reset-after-init";
  };
}

export interface StateDiff {
  before?: unknown;
  after?: unknown;
  changed: string[];
}

export interface EvalResult {
  runId: string;
  executionId: string;
  caseId: string;
  repetition?: number;
  repetitionTotal?: number;
  passed: boolean;
  assertions: Array<{ id: string; passed: boolean; message?: string; details?: unknown }>;
  coverage: CoverageSummary;
  output?: unknown;
  input?: unknown;
  metrics?: { latencyMs: number; steps: number; toolCalls: number; budgetUsed?: number };
  failureCategory?: string;
  trajectoryId?: string;
  trajectory?: Trajectory;
  stateDiff?: StateDiff;
  createdAt?: string;
  sourceCase?: SourceCaseSnapshot;
}

export type RunnerEvent =
  | { type: "execution.started"; runId: string; executionId: string; caseId: string }
  | { type: "trace.event"; executionId: string; event: TrajectoryEvent }
  | { type: "coverage.updated"; executionId: string; coverage: CoverageSummary }
  | { type: "execution.finished"; executionId: string; result: EvalResult }
  | { type: "execution.failed"; executionId: string; error: string };

export interface RunSnapshot {
  runId: string;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  totalCases: number;
  completedCases: number;
  passedCases: number;
  results: EvalResult[];
  coverage?: CoverageSummary;
  events: RunnerEvent[];
  improvements?: unknown[];
  gate?: CoverageGateResult;
  replayOf?: string;
  candidateOf?: string;
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
