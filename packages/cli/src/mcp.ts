import type { ProjectContext, RunSnapshot } from "@canary/core";
import { CanaryMcpServer, COMPATIBILITY_MATRIX, serveStdio, type CanaryMcpPorts } from "@canary/mcp-server";
import { resolveProjectContext } from "./home.js";
import { hostEvidenceOutput, validateHostProposal } from "./host.js";

export interface McpCliBindings {
  readRun(runId: string, context: ProjectContext): RunSnapshot | undefined;
  runHeadless(input: { context: ProjectContext; caseId?: string; signal?: AbortSignal }): Promise<unknown>;
}

ex