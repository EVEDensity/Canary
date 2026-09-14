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
  const token = flag(rest, "--token") ?? process.env.CANARY_MCP_TOKEN;
  if (!token?.trim()) {
    console.error("canary mcp serve requires --token or CANARY_MCP_TOKEN");
    return 1;
  }
  const context = resolveProjectContext({ configPath });
  const server = new CanaryMcpServer({
    token,
    maxConcurrent: 1,
    ports: bindPorts(context, bindings),
  });
  await serveStdio(server);
  return 0;
}

function bindPorts(context: ProjectContext, bindings: McpCliBindings): CanaryMcpPorts {
  return {
    projectRoot: context.projectRoot,
    async run(input, signal) {
