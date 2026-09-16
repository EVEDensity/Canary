/** Public contracts for Canary's local Agent evaluation runtime. */

import { parseCanaryConfig } from "./schema.js";
import type { CanaryConfig, SourceCaseSnapshot, TestCase } from "./types.js";

export { IPC_PROTOCOL_VERSION, IPC_MAX_BYTES } from "./schema.js";
export * from "./types.js";
export * from "./contracts.js";
export * from "./ports.js";

export function defineConfig(config: CanaryConfig): CanaryConfig {
  return parseCanaryConfig(config) as CanaryConfig;
}

export function snapshotSourceCase(testCase: TestCase): SourceCaseSnapshot {
  return {
    id: testCase.id,
    input: testCase.input,
    tags: testCase.tags,
    expectedFeatures: testCase.expectedFeatures,
    assertions: testCase.assertions,
    environment: testCase.environment,
    dataset: testCase.dataset,
  };
}

export { defineCase, defineCases, expect, canaryExpect } from "./dsl.js";

export {
  SchemaValidationError,
  invalidInput,
  canaryConfigSchema,
  childMessageSchema,
  parseCanaryConfig,
  parseChildMessage,
  parseCoverageSummary,
  parseReplayRequest,
  parseReplayResponse,
  parseReportFormat,
  parseRunSnapshot,
  parseSuggestionDecision,
  parseTestCase,
  replayRequestSchema,
  reportFormatSchema,
  runSnapshotSchema,
} from "./schema.js";

export * from "./cli-contracts.js";
