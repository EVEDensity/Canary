import type { ProjectContext, RunSnapshot } from "@canary/core";
import { CanaryMcpServer, COMPATIBILITY_MATRIX, serveStdio, type CanaryMcpPorts } from "@canary/mcp-server";
import { resolveProjectContext } from "./home.js";
import { hostEvidenceOutput, validateHostProposal } from "./host.js";

export interface McpCliBindings {
  readRun(runId: string, context: ProjectContext): RunSnapshot | undefined;
  runHeadless(input: { context: ProjectContext; caseId?: string; signal?: AbortSignal }): Promise<unknown>;
}

export async function mcpCommand(rest: string[], configPath: string | undefined, bindings: McpCliBindings): Promise<number> {
  const action = rest[0] ?? "matrix";
  if (action === "matrix") {
    console.log(JSON.stringify({ ...COMPATIBILITY_MATRIX, kind: "canary.mcp.matrix" }, null, 2));
    return 0;
  }
  if (action !== "serve") {
    console.error("Usage: canary mcp matrix | canary mcp serve --token <token> [--config <path>]");
    return 1;
  }
  const token = flag(rest, "--token") ?? process.env.CANARY_MCP_TO