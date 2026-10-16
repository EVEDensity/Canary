import type { ProjectContext, RunSnapshot } from "@canary/core";
import { FileArtifactRepository, buildRunDiagnostics, type RunDiagnostics } from "@canary/trace";
import { verificationReceiptSchema } from "@canary/core";
import { existsSync } from "node:fs";
import type { StructureSnapshot, StructureChange, ArchitectureAnalysis, ChangeImpact, CiSelectionPlan } from "@canary/structure";
import { CanaryMcpServer, COMPATIBILITY_MATRIX, serveStdio, type CanaryMcpPorts } from "@canary/mcp-server";
import { resolveProjectContext } from "./home.js";
import { hostEvidenceOutput, recordHostProposal } from "./host.js";

export interface McpCliBindings {
  readRun(runId: string, context: ProjectContext): RunSnapshot | undefined;
  runHeadless(input: { context: ProjectContext; caseId?: string; signal?: AbortSignal }): Promise<unknown>;
  verify?(input: import("@canary/mcp-server").CanaryMcpOperationInput, context: ProjectContext, signal: AbortSignal): Promise<unknown>;
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
  const repository = new FileArtifactRepository(context.artifactRoot);
  const sealedRun = (runId: string) => {
    if (repository.verify(runId).status !== "verified") throw new Error("Sealed evidence in the bound project is required");
    const run = bindings.readRun(runId, context);
    if (!run) throw new Error("Run not found in bound project");
    return run;
  };
  return {
    projectRoot: context.projectRoot,
    async run(input, signal) {
      return bindings.runHeadless({ context, caseId: input.caseId, signal });
    },
    evidence(input) {
      const snapshot = sealedRun(input.runId);
      return hostEvidenceOutput(snapshot, {
        caseId: input.caseId,
        maxCases: input.maxCases,
        maxEventsPerCase: input.maxEvents,
        maxChecks: input.maxChecks,
        checkOffset: input.checkOffset,
      });
    },
    diagnostics(input) {
      const run = sealedRun(input.runId), result = buildRunDiagnostics(run, context.projectRoot);
      return diagnosticsPage(result, input.checkOffset ?? 0, input.maxChecks ?? 16);
    },
    verification(input) {
      sealedRun(input.runId);
      const file = input.kind === "repair" ? "repair-verification.json" : input.kind === "change" ? "change-verification.json" : "reproduction.json";
      const receipt = repository.readJson(input.runId, file);
      const parsed = verificationReceiptSchema.safeParse(receipt);
      if (!parsed.success) return { v: 1, kind: "canary.host.verification", runId: input.runId, outcome: "unavailable", reason: "Receipt is missing or has an unsupported schema", receiptFile: file };
      const value = parsed.data;
      const expectedKind = { repair: "canary.repair-verification", change: "canary.change-verification", reproduction: "canary.reproduction-result" }[input.kind];
      if (value.kind !== expectedKind || ("runId" in value && value.runId !== input.runId) || (value.kind === "canary.repair-verification" && value.candidate.runId !== input.runId && value.beforeRegression?.runId !== input.runId)) throw new Error("Receipt identity does not match the bound run");
      const legacyRepair = value.kind === "canary.repair-verification" && value.outcome === "verified" && value.beforeRegression?.sourceUnchanged !== true;
      return { v: 1, kind: "canary.host.verification", runId: input.runId, manifestHash: repository.verify(input.runId).manifestHash, outcome: legacyRepair ? "evidence-insufficient" : value.kind === "canary.change-verification" ? "measured" : value.outcome, reason: legacyRepair ? "Historical receipt does not prove execution source identity" : undefined, ...boundedReceipt(value) };
    },
    async executeVerification(input, signal) {
      sealedRun(input.runId);
      if (input.candidateRunId) sealedRun(input.candidateRunId);
      if (!bindings.verify) throw new Error("Verification execution is not bound");
      return bindings.verify(input, context, signal);
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
      const snapshot = sealedRun(runId);
      return recordHostProposal(proposal, snapshot, context.artifactRoot);
    },
  };
}

/** Page by retained failure identity; large evidence stays available through the CLI. */
function diagnosticsPage(result: RunDiagnostics, offset: number, limit: number) {
  const failures = result.failures.slice(offset, offset + limit);
  const page = () => ({ offset, total: result.failures.length, returned: failures.length, nextOffset: offset + failures.length < result.failures.length ? offset + failures.length : null });
  const view = () => {
    const checks = new Set(failures.map(failure => failure.checkId));
    return { ...result, untrustedEvidence: true, failures: [...failures], reproduction: { ...result.reproduction, commands: result.reproduction.commands.filter(command => checks.has(command.checkId)) }, page: page() };
  };
  let output = view();
  while (failures.length > 1 && Buffer.byteLength(JSON.stringify(output)) > 65_536) { failures.pop(); output = view(); }
  if (Buffer.byteLength(JSON.stringify(output)) <= 65_536) return output;
  const text = (value: string | undefined, max = 256) => value?.slice(0, max);
  const item = failures[0];
  const fallback = { v: result.v, kind: result.kind, runId: text(result.runId), untrustedEvidence: true,
    failures: item ? [{ id: text(item.id), checkId: text(item.checkId), caseId: text(item.caseId), executionId: text(item.executionId), category: text(item.category),
      originalError: { stdout: text(item.originalError.stdout, 2000), stderr: text(item.originalError.stderr, 2000), truncated: true },
      locations: item.locations.slice(0, 12).map(location => ({ ...location, path: text(location.path) })), sourceMapping: item.sourceMapping,
      testNames: item.testNames.slice(0, 8).map(name => text(name, 128)), stack: item.stack.slice(0, 8).map(line => text(line)),
      assertions: item.assertions.slice(0, 8).map(assertion => ({ id: text(assertion.id, 96), message: text(assertion.message) })),
      rootCause: { status: item.rootCause.status, reason: text(item.rootCause.reason) },
    }] : [],
    reproduction: { gitCommit: text(result.reproduction.gitCommit), gitDirty: result.reproduction.gitDirty,
      commands: result.reproduction.commands.filter(command => command.checkId === item?.checkId).slice(0, 1).map(command => ({ checkId: text(command.checkId), command: text(command.command), cwd: text(command.cwd), args: command.args?.slice(0, 16).map(arg => text(arg, 128)), argumentsTruncated: (command.args?.length ?? 0) > 16 || Boolean(command.args?.some(arg => arg.length > 128)) })) },
    page: page(), truncated: true, reasonForTruncation: "Read full retained diagnostics through the CLI or project artifact" };
  if (Buffer.byteLength(JSON.stringify(fallback)) <= 65_536) return fallback;
  // JSON escaping can expand control characters sixfold; enforce the encoded budget too.
  return { v: 1, kind: "canary.diagnostics", runId: text(result.runId, 128), untrustedEvidence: true,
    failures: item ? [{ id: text(item.id, 128), checkId: text(item.checkId, 128), caseId: text(item.caseId, 128), executionId: text(item.executionId, 128), category: text(item.category, 128), evidenceOmitted: true }] : [],
    reproduction: { gitCommit: text(result.reproduction.gitCommit, 128), commands: [] }, page: page(), truncated: true,
    reasonForTruncation: "Escaped evidence exceeded the response budget; read the full diagnostic through the CLI" };
}

export function boundedReceipt(value: Record<string, unknown>) {
  if (Buffer.byteLength(JSON.stringify(value)) <= 65_536) return { receipt: value, truncated: false };
  const text = (item: unknown) => typeof item === "string" ? item.slice(0, 512) : undefined;
  const fields = (item: unknown, keys: string[]) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(keys.map(key => [key, text((item as Record<string, unknown>)[key])])) : undefined;
  const identity = (item: unknown) => fields(item, ["runId", "commit", "manifestHash"]);
  const before = value.beforeRegression as Record<string, unknown> | undefined;
  const fingerprint = (item: unknown) => fields(item, ["commit", "indexHash", "trackedStatusHash", "sourceHash", "trackedFilesHash"]);
  const observations = (item: unknown) => {
    const record = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : undefined;
    return record ? { v: record.v === 1 ? 1 : undefined, ...fields(record, ["kind", "runId", "status", "projectPath"]), before: fingerprint(record.before), after: fingerprint(record.after) } : undefined;
  };
  const sources = value.executionSources as Record<string, unknown> | undefined;
  const summary = { receipt: {
    v: value.v === 1 ? 1 : undefined, kind: text(value.kind), outcome: text(value.outcome), runId: text(value.runId),
    original: identity(value.original), candidate: identity(value.candidate),
    executionSources: sources ? { original: observations(sources.original), candidate: observations(sources.candidate) } : undefined,
    beforeRegression: before ? { ...identity(before), sourceUnchanged: before.sourceUnchanged === true, executionSource: fingerprint(before.executionSource), observedSource: fingerprint(before.observedSource) } : undefined,
    baseline: text(value.baseline), commit: text(value.commit), manifestHash: text(value.manifestHash), sourceRunId: text(value.sourceRunId),
    sourceUnchanged: value.sourceUnchanged === true, executed: value.executed === true, reviewRequired: value.reviewRequired === true,
    reasons: Array.isArray(value.reasons) ? value.reasons.slice(0, 16).map(text) : undefined,
    omittedFindings: Array.isArray(value.findings) ? value.findings.length : undefined,
  }, truncated: true, reasonForTruncation: "Read full receipt through the CLI or project artifact" };
  if (Buffer.byteLength(JSON.stringify(summary)) <= 65_536) return summary;
  const shortIdentity = (item: unknown) => Object.fromEntries(Object.entries(identity(item) ?? {}).map(([key, item]) => [key, item?.slice(0, 128)]));
  return { receipt: { v: value.v === 1 ? 1 : undefined, kind: text(value.kind)?.slice(0, 128), outcome: text(value.outcome)?.slice(0, 64),
    runId: text(value.runId)?.slice(0, 128), original: shortIdentity(value.original), candidate: shortIdentity(value.candidate),
    reviewRequired: value.reviewRequired === true, evidenceOmitted: true,
    reasons: Array.isArray(value.reasons) ? value.reasons.slice(0, 4).map(item => text(item)?.slice(0, 128)) : undefined }, truncated: true, reasonForTruncation: "Escaped receipt exceeded the response budget; read the full project artifact" };
}
export function boundConfig(context: ProjectContext): string | undefined {
  return existsSync(context.configFile) ? context.configFile : undefined;
}

function flag(rest: string[], name: string): string | undefined {
  const index = rest.indexOf(name);
  return index >= 0 ? rest[index + 1] : undefined;
}
