import type { ProjectContext, RunSnapshot } from "@canary/core";
import { FileArtifactRepository } from "@canary/trace";
import type { StructureSnapshot, StructureChange, ArchitectureAnalysis, ChangeImpact, CiSelectionPlan } from "@canary/structure";
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

export function bindPorts(context: ProjectContext, bindings: McpCliBindings): CanaryMcpPorts {
  return {
    projectRoot: context.projectRoot,
    async run(input, signal) {
      return bindings.runHeadless({ context, caseId: input.caseId, signal });
    },
    evidence(input) {
      const snapshot = bindings.readRun(input.runId, context);
      if (!snapshot) throw new Error(`Run not found in bound project: ${input.runId}`);
      return hostEvidenceOutput(snapshot, {
        caseId: input.caseId,
        maxCases: input.maxCases,
        maxEventsPerCase: input.maxEvents,
      });
    },
    structure(input) {
      const repository = new FileArtifactRepository(context.artifactRoot);
      const integrity = repository.verify(input.runId);
      if (integrity.status !== "verified") throw new Error(`Run structure evidence is ${integrity.status}; sealed evidence is required`);
      const structure = repository.readJson<StructureSnapshot>(input.runId, "structure.json");
      if (!structure || structure.kind !== "canary.structure" || structure.v !== 1) throw new Error("This run has no compatible structure snapshot");
      const change = repository.readJson<StructureChange>(input.runId, "structure-change.json");
      const prefix = input.pathPrefix?.replace(/\/$/, "");
      const matching = structure.nodes.filter((node) => !prefix || prefix === "." || node.path === prefix || node.path.startsWith(`${prefix}/`));
      const offset = input.offset ?? 0;
      const nodes = matching.slice(offset, offset + (input.maxNodes ?? 100));
      const ids = new Set(nodes.map((node) => node.id));
      const edges = structure.edges.filter((edge) => ids.has(edge.from));
      const unknown = structure.unknown.filter((item) => ids.has(item.from));
      const changes = change?.entries.filter((item) => !prefix || prefix === "." || item.path === prefix || item.path.startsWith(`${prefix}/`));
      const analysis = repository.readJson<ArchitectureAnalysis>(input.runId, "architecture-analysis.json");
      const impact = repository.readJson<ChangeImpact>(input.runId, "change-impact.json");
      const ciPlan = repository.readJson<CiSelectionPlan>(input.runId, "ci-plan.json");
      return {
        v: 1, kind: "canary.host.structure", runId: input.runId,
        source: structure.source, manifestHash: integrity.manifestHash,
        layers: structure.layers, nodes,
        analysis: analysis ? { basis: analysis.basis, findings: analysis.findings.filter((finding) => finding.nodeIds.some((id) => ids.has(id))).slice(0, 30).map((finding) => ({ ...finding, nodeIds: finding.nodeIds.slice(0, 40), edgeIds: finding.edgeIds.slice(0, 80), paths: finding.paths.slice(0, 40), totalNodes: finding.nodeIds.length, totalEdges: finding.edgeIds.length })), totalFindings: analysis.findings.length, omittedFindings: analysis.omittedFindings, unresolvedRelations: analysis.unresolvedRelations } : undefined,
        impact: impact ? { baseline: impact.baseline, confidence: impact.confidence, fallbackReasons: impact.fallbackReasons, affected: impact.affected.filter((item) => ids.has(item.nodeId)), totalAffected: impact.affected.length, limitations: impact.limitations } : undefined,
        ciPlan: ciPlan ? { mode: ciPlan.mode, requested: ciPlan.requested, selectedCount: ciPlan.selectedCount, omittedCount: ciPlan.omittedCount, fallbackReasons: ciPlan.fallbackReasons, checks: ciPlan.checks.slice(0, 30).map((check) => ({ ...check, matchedPaths: check.matchedPaths.slice(0, 8) })), totalChecks: ciPlan.checks.length } : undefined,
        edges: edges.slice(input.edgeOffset ?? 0, (input.edgeOffset ?? 0) + 400),
        unknown: unknown.slice(input.unknownOffset ?? 0, (input.unknownOffset ?? 0) + 100),
        change: change ? { baseline: change.baseline, entries: changes?.slice(input.changeOffset ?? 0, (input.changeOffset ?? 0) + 200), totalEntries: changes?.length, nextOffset: (input.changeOffset ?? 0) + 200 < (changes?.length ?? 0) ? (input.changeOffset ?? 0) + 200 : null } : undefined,
        page: { offset, returned: nodes.length, matching: matching.length, nextOffset: offset + nodes.length < matching.length ? offset + nodes.length : null, edgeTotal: edges.length, nextEdgeOffset: (input.edgeOffset ?? 0) + 400 < edges.length ? (input.edgeOffset ?? 0) + 400 : null, unknownTotal: unknown.length, nextUnknownOffset: (input.unknownOffset ?? 0) + 100 < unknown.length ? (input.unknownOffset ?? 0) + 100 : null },
      };
    },
    submitProposal(input) {
      const proposal = input.proposal;
      const runId = proposal && typeof proposal === "object" && "runId" in proposal ? String((proposal as { runId: unknown }).runId) : "";
      const snapshot = bindings.readRun(runId, context);
      if (!snapshot) throw new Error("submit_proposal requires a proposal.runId that exists in the bound project");
      return validateHostProposal(proposal, snapshot);
    },
  };
}

function flag(rest: string[], name: string): string | undefined {
  const index = rest.indexOf(name);
  return index >= 0 ? rest[index + 1] : undefined;
}
