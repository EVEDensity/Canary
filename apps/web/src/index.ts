import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseCoverageSummary,
  parseReplayRequest,
  parseReplayResponse,
  parseReportFormat,
  parseRunSnapshot,
  parseSuggestionDecision,
  SchemaValidationError,
  invalidInput,
  type ProjectChecksConfig,
  type CoverageManifest,
} from "@canary/core";
import { renderReport } from "@canary/reporters";
import {
  compareRuns,
  assessAgentComparison,
  assessProjectComparison,
  decideSuggestion,
  holdoutCaseIds,
  writeRegressionDrafts,
  type ImprovementSuggestion,
} from "@canary/improvement";
import {
  ArtifactIntegrityError,
  buildRunDiagnostics,
  createDiagnosticBundle,
  FileArtifactRepository,
  redactRunSnapshot,
  redactValue,
  RunStore,
  stableHash,
} from "@canary/trace";
import { renderWorkspace } from "./workspace-ui.js";
import { linkCoverage, type StructureSnapshot, type StructureChange } from "@canary/structure";
import { readStructureSource } from "./structure-source.js";
import { checkLogs, mapCoverageToStructure, mapFailuresToStructure, type DiagnosticSource } from "./structure-diagnostics.js";
import { issueFromCheck } from "./project-issues.js";
import { WorkspaceReader } from "./workspace.js";

export type { RunSnapshot } from "@canary/core";
export { FileArtifactRepository, RunStore, SSE_HEARTBEAT_MS, type SseEvent } from "@canary/trace";
export { CANONICAL_SSE_EVENTS } from "@canary/core";

export interface WebServerHooks {
  projectPage?: boolean;
  onRetry?: (runId: string, request: { checkId?: string; failed?: boolean }) => Promise<{ runId: string }>;
  onClose?: () => void;
  onReplay?: (runId: string, request: { caseId?: string }) => Promise<{ replayRunId: string }>;
  /** Required for POST replay/improvements. CORS is not authorization. */
  writeToken?: string;
}

export function replayCommand(runId: string): string {
  return `canary replay ${runId}`;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 65536) invalidInput("JSON body", "Request body exceeds 64 KiB");
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    invalidInput("JSON body", "Request body is not valid JSON");
  }
}

function writeJson(response: ServerResponse<IncomingMessage>, status: number, payload: unknown): void {
  const body = JSON.stringify(redactValue(payload));
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(body);
}

function writeError(response: ServerResponse<IncomingMessage>, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  writeJson(response, error instanceof ArtifactIntegrityError ? 409 : 400, { error: message });
}

function resolveProjectRootFromArtifacts(artifactRoot: string): string {
  const normalized = resolve(artifactRoot);
  const parent = resolve(normalized, "..");
  if (basename(parent) === ".canary") return resolve(parent, "..");
  let dir = normalized;
  while (true) {
    if (existsSync(resolve(dir, "canary.config.ts"))) return dir;
    const parentDir = dirname(dir);
    if (parentDir === dir) break;
    dir = parentDir;
  }
  return normalized;
}

function resolveRegressionDir(projectRoot: string): string {
  if (existsSync(resolve(projectRoot, "cases/regression"))) return resolve(projectRoot, "cases/regression");
  if (existsSync(resolve(projectRoot, "examples/local-agent/cases")))
    return resolve(projectRoot, "examples/local-agent/cases/regression");
  return resolve(projectRoot, "cases/regression");
}

function requestWriteToken(request: IncomingMessage, url: URL): string | undefined {
  const header = request.headers["x-canary-write-token"];
  if (typeof header === "string" && header) return header;
  const query = url.searchParams.get("token");
  return query || undefined;
}

function allowWrite(request: IncomingMessage, url: URL, hooks?: WebServerHooks): boolean {
  return Boolean(hooks?.writeToken) && requestWriteToken(request, url) === hooks?.writeToken;
}

export function createWebServer(
  store: RunStore,
  host = "127.0.0.1",
  port = 0,
  artifactRoot?: string,
  hooks?: WebServerHooks,
) {
  if (!["127.0.0.1", "::1", "localhost"].includes(host)) throw new Error("Report service requires a loopback host");
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid report port");
  const artifacts = artifactRoot ? new FileArtifactRepository(resolve(artifactRoot)) : undefined;
  const workspace = new WorkspaceReader(store, artifacts);
  const server = createServer((request: IncomingMessage, response: ServerResponse<IncomingMessage>) => {
    void handleRequest(store, request, response, hooks, artifacts, workspace);
  });
  return {
    server,
    listen: () =>
      new Promise<{ url: string; port: number }>((resolveListen, rejectListen) => {
        const onError = (error: NodeJS.ErrnoException): void => {
          if (error.code === "EADDRINUSE") rejectListen(new Error(`Port ${port} is already in use`));
          else rejectListen(error);
        };
        server.once("error", onError);
        server.listen(port, host, () => {
          server.off("error", onError);
          const address = server.address();
          const actualPort = typeof address === "object" && address ? address.port : port;
          resolveListen({ url: `http://${host === "::1" ? "[::1]" : host}:${actualPort}`, port: actualPort });
        });
      }),
  };
}

async function handleRequest(
  store: RunStore,
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
  hooks?: WebServerHooks,
  artifacts?: FileArtifactRepository,
  workspace?: WorkspaceReader,
): Promise<void> {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const parts = url.pathname.split("/").filter(Boolean);
    const origin = `http://${request.headers.host}`;
    if (!["127.0.0.1", "[::1]", "localhost"].includes(new URL(origin).hostname)) {
      writeJson(response, 421, { error: "Loopback host required" });
      return;
    }
    if (request.headers.origin && request.headers.origin !== origin) {
      writeJson(response, 403, { error: "Same-origin request required" });
      return;
    }
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    if (url.pathname.startsWith("/assets/fonts/")) {
      const name = url.pathname.slice("/assets/fonts/".length);
      if (!/^(?:fonts\.css|[a-z0-9-]+\.woff2)$/.test(name)) {
        response.writeHead(404);
        response.end();
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD" });
        response.end();
        return;
      }
      const path = fileURLToPath(new URL(`../assets/fonts/${name}`, import.meta.url));
      if (!existsSync(path)) {
        response.writeHead(404);
        response.end();
        return;
      }
      const content = readFileSync(path);
      response.writeHead(200, {
        "Content-Type": name.endsWith(".css") ? "text/css; charset=utf-8" : "font/woff2",
        "Content-Length": content.length,
        "Cache-Control": "public, max-age=3600",
      });
      response.end(request.method === "HEAD" ? undefined : content);
      return;
    }

    if (parts[0] === "api" && parts[1] === "workspace" && parts[2] === "runs") {
      if (request.method !== "GET") {
        writeJson(response, 405, { error: "GET required" });
        return;
      }
      const value = parts[3] ? workspace?.read(parts[3]) : workspace?.list();
      response.writeHead(value ? 200 : 404, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(value ?? { error: "Run not found" }));
      return;
    }
    if (parts[0] === "api" && parts[1] === "structure" && (parts.length === 2 || (parts.length === 3 && parts[2] === "source"))) {
      if (request.method !== "GET") { writeJson(response, 405, { error: "GET required" }); return; }
      const runId = url.searchParams.get("runId");
      if (!runId || !artifacts) { writeJson(response, 400, { error: "A saved runId and artifact repository are required" }); return; }
      const integrity = artifacts.verify(runId);
      if (integrity.status === "invalid") throw new ArtifactIntegrityError(integrity);
      if (integrity.status !== "verified") { writeJson(response, 409, { error: `Structure evidence is ${integrity.status}` }); return; }
      const structure = artifacts.readJson<StructureSnapshot>(runId, "structure.json");
      if (!structure) { writeJson(response, 404, { error: "This run predates structure snapshots; current source cannot describe historical code" }); return; }
      if (parts[2] === "source") {
        const nodeId = url.searchParams.get("nodeId");
        const center = Number(url.searchParams.get("line"));
        const detail = nodeId ? readStructureSource(structure, nodeId, center) : undefined;
        writeJson(response, detail ? 200 : 404, detail ?? { error: "Source node not found" });
        return;
      }
      const run = artifacts.readRun(runId);
      const coverage = run?.coverage ?? artifacts.readCoverage(runId);
      const coverageLinks = coverage ? linkCoverage(structure, coverage, structure.source.projectRoot) : [];
      const diagnosticSources: DiagnosticSource[] = [];
      if (coverage) diagnosticSources.push({ runId, coverage, manifest: artifacts.readJson<CoverageManifest>(runId, "coverage-manifest.json") });
      const checkLinks: Array<{ nodeId: string; checkId: string; runId: string; evidence: "coverage-observed" }> = [];
      for (const check of run?.checks ?? []) {
        if (!check.childRun) continue;
        const childIntegrity = artifacts.verify(check.childRun.runId);
        if (childIntegrity.status !== "verified" || childIntegrity.manifestHash !== check.childRun.manifestHash) continue;
        const childCoverage = artifacts.readCoverage(check.childRun.runId);
        if (!childCoverage) continue;
        diagnosticSources.push({ runId: check.childRun.runId, checkId: check.id, coverage: childCoverage, manifest: artifacts.readJson<CoverageManifest>(check.childRun.runId, "coverage-manifest.json") });
        for (const link of linkCoverage(structure, childCoverage, structure.source.projectRoot))
          if (link.nodeId && link.provenance === "runtime") checkLinks.push({ nodeId: link.nodeId, checkId: check.id, runId: check.childRun.runId, evidence: "coverage-observed" });
      }
      const failures = mapFailuresToStructure(structure, workspace?.read(runId)?.issues ?? [], checkLogs(run?.checks));
      // Historical markers are shown only when the old and selected file bytes share a sealed hash.
      // A changed file remains in history but is never painted onto today's source.
      const currentFiles = new Map(structure.nodes.filter((node) => node.kind === "file").map((node) => [node.path, node.sourceHash]));
      let historicalRuns = 0;
      for (const row of workspace?.list(12) ?? []) {
        if (historicalRuns >= 3 || failures.length >= 60) break;
        if (row.runId === runId || row.startedAt >= (run?.startedAt ?? structure.capturedAt) || row.status !== "failed") continue;
        const previousIntegrity = artifacts.verify(row.runId);
        if (previousIntegrity.status !== "verified") continue;
        const previousStructure = artifacts.readJson<StructureSnapshot>(row.runId, "structure.json");
        const previousRun = artifacts.readRun(row.runId);
        if (!previousStructure || !previousRun || previousStructure.source.projectRoot !== structure.source.projectRoot) continue;
        historicalRuns++;
        const oldIssues = (previousRun.checks ?? []).filter((check) => check.status === "failed").map((check) => issueFromCheck(row.runId, check));
        for (const failure of mapFailuresToStructure(previousStructure, oldIssues, checkLogs(previousRun.checks), true)) {
          if (!failure.path || !failure.fileNodeId) continue;
          const oldFile = previousStructure.nodes.find((node) => node.id === failure.fileNodeId);
          if (oldFile?.sourceHash === currentFiles.get(failure.path)) failures.push(failure);
        }
      }
      writeJson(response, 200, {
        structure,
        change: artifacts.readJson<StructureChange>(runId, "structure-change.json"),
        analysis: artifacts.readJson(runId, "architecture-analysis.json"),
        impact: artifacts.readJson(runId, "change-impact.json"),
        ciPlan: artifacts.readJson(runId, "ci-plan.json"),
        coverageLinks,
        checkLinks,
        diagnostics: {
          measurements: mapCoverageToStructure(structure, diagnosticSources),
          failures,
        },
        integrity: { status: integrity.status, manifestHash: integrity.manifestHash },
      });
      return;
    }
    if (url.pathname === "/api/session/close") {
      if (request.method !== "POST" || !allowWrite(request, url, hooks)) {
        writeJson(response, 403, { error: "Write token required" });
        return;
      }
      if (!hooks?.onClose) {
        writeJson(response, 409, { error: "Session close unavailable" });
        return;
      }
      writeJson(response, 200, { closed: true });
      hooks.onClose();
      return;
    }
    if (url.pathname === "/logo.png" || url.pathname === "/favicon.ico") {
      const logoPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../docs/images/logo.png");
      if (existsSync(logoPath)) {
        const buf = readFileSync(logoPath);
        response.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=86400" });
        response.end(buf);
        return;
      }
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        renderWorkspace(hooks?.writeToken, {
          retry: Boolean(hooks?.onRetry),
          replay: Boolean(hooks?.onReplay),
          close: Boolean(hooks?.onClose),
        }),
      );
      return;
    }
    if (parts[0] === "api" && parts[1] === "compare") {
      const baselineId = url.searchParams.get("baseline");
      const candidateId = url.searchParams.get("candidate");
      if (!baselineId || !candidateId) {
        writeJson(response, 400, { error: "baseline and candidate query parameters are required" });
        return;
      }
      for (const id of [baselineId, candidateId])
        if (artifacts?.verify(id).status === "invalid") throw new ArtifactIntegrityError(artifacts.verify(id));
      if (artifacts) for (const id of [baselineId, candidateId]) store.hydrateRun(artifacts, id);
      // Assess original sealed values: redaction can collapse different inputs to the
      // same placeholder and make unrelated cases appear identical. writeJson redacts output.
      const baseline = store.get(baselineId);
      const candidate = store.get(candidateId);
      if (!baseline || !candidate) {
        writeJson(response, 404, { error: "Both baseline and candidate runs must exist" });
        return;
      }
      if (baseline.checks || candidate.checks) {
        if (!baseline.checks || !candidate.checks) {
          writeJson(response, 400, { error: "Choose two project runs" });
          return;
        }
        const ids = [...new Set([...baseline.checks, ...candidate.checks].map((check) => check.id))];
        const baselinePlan = artifacts?.readJson<ProjectChecksConfig>(baselineId, "check-plan.json");
        const candidatePlan = artifacts?.readJson<ProjectChecksConfig>(candidateId, "check-plan.json");
        const assessment = assessProjectComparison(baseline, candidate, {
          sealed:
            artifacts?.verify(baselineId).status === "verified" && artifacts?.verify(candidateId).status === "verified",
          samePlan: Boolean(baselinePlan && candidatePlan && stableHash(baselinePlan) === stableHash(candidatePlan)),
          linkedRetry:
            candidate.retryOf === baselineId &&
            candidate.evidence?.lineage.parentManifestHash === artifacts?.verify(baselineId).manifestHash,
        });
        writeJson(response, 200, {
          kind: "canary.project-comparison",
          baseline: baselineId,
          candidate: candidateId,
          assessment,
          checks: ids.map((id) => ({
            id,
            before: baseline.checks!.find((check) => check.id === id)?.status ?? "not-run",
            after: candidate.checks!.find((check) => check.id === id)?.status ?? "not-run",
          })),
        });
        return;
      }
      const holdout = holdoutCaseIds([...baseline.results, ...candidate.results]);
      const comparison = compareRuns(baseline, candidate, holdout);
      writeJson(response, 200, { ...comparison, assessment: assessAgentComparison(baseline, candidate, comparison) });
      return;
    }
    if (parts[0] === "api" && parts[1] === "runs" && parts.length === 2) {
      if (artifacts) {
        if (hooks?.projectPage) {
          for (const row of workspace?.list() ?? []) if (row.kind === "project") store.hydrateRun(artifacts, row.runId);
        } else store.hydrate(artifacts);
      }
      // The project page consumes check runs only. Do not serialize unrelated Agent
      // trajectories into its frequently polled history response.
      const runs = store.list().filter((run) => !hooks?.projectPage || run.checks !== undefined);
      writeJson(
        response,
        200,
        runs.map((run) => ({
          ...store.sanitize(parseRunSnapshot(run, "GET /api/runs")),
          integrity: artifacts?.verify(run.runId),
        })),
      );
      return;
    }
    if (parts[0] === "api" && parts[1] === "runs" && parts[2]) {
      const runId = parts[2];
      if (parts[3] === "integrity" && artifacts) {
        writeJson(response, 200, artifacts.verify(runId));
        return;
      }
      if (artifacts?.verify(runId).status === "invalid") throw new ArtifactIntegrityError(artifacts.verify(runId));
      if (artifacts) store.hydrateRun(artifacts, runId);
      const run = store.sanitize(store.get(runId));
      if (!run) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      if (parts[3] === "diagnostics") {
        if (request.method !== "GET") { writeJson(response, 405, { error: "GET required" }); return; }
        const root = artifacts ? resolveProjectRootFromArtifacts(artifacts.rootDir) : process.cwd();
        if (parts[4] === "bundle") {
          if (!artifacts || artifacts.verify(runId).status !== "verified") { writeJson(response, 409, { error: "Export requires sealed, verified evidence" }); return; }
          response.setHeader("content-disposition", 'attachment; filename="diagnostics.json"');
          const source = artifacts.readRun(runId);
          if (!source) { writeJson(response, 404, { error: "Run not found" }); return; }
          const bundle = createDiagnosticBundle(source, root);
          response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
          response.end(JSON.stringify(bundle));
        } else {
          response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
          response.end(JSON.stringify(buildRunDiagnostics(store.get(runId)!, root)));
        }
        return;
      }
      if (parts[3] === "retry") {
        if (request.method !== "POST") {
          writeJson(response, 405, { error: "POST required" });
          return;
        }
        if (!allowWrite(request, url, hooks)) {
          writeJson(response, 403, { error: "Write token required" });
          return;
        }
        const body = await readJsonBody(request);
        if (
          !body ||
          typeof body !== "object" ||
          Array.isArray(body) ||
          Object.keys(body).some((key) => !["checkId", "failed"].includes(key))
        ) {
          writeJson(response, 400, { error: "Invalid retry request" });
          return;
        }
        const retry = body as { checkId?: string; failed?: boolean };
        if (
          ((typeof retry.checkId !== "string" || !retry.checkId) && retry.failed !== true) ||
          (retry.checkId && retry.failed !== undefined)
        ) {
          writeJson(response, 400, { error: "Choose checkId or failed:true" });
          return;
        }
        if (!hooks?.onRetry) {
          writeJson(response, 409, { error: "Retry unavailable in this session" });
          return;
        }
        try {
          writeJson(response, 202, await hooks.onRetry(runId, retry));
        } catch (error) {
          writeJson(response, 409, { error: error instanceof Error ? error.message : "Retry rejected" });
        }
        return;
      }
      if (parts[3] === "events") {
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        response.write("retry: 2000\n\n");
        const rawId = request.headers["last-event-id"];
        const lastEventId = rawId === undefined || rawId === "" ? undefined : Number.parseInt(String(rawId), 10);
        const unsubscribe = store.subscribe(runId, response, lastEventId);
        request.on("close", unsubscribe);
        request.on("error", unsubscribe);
        return;
      }
      if (parts[3] === "replay") {
        if (request.method !== "POST") {
          response.writeHead(405);
          response.end("Method Not Allowed");
          return;
        }
        if (!allowWrite(request, url, hooks)) {
          writeJson(response, 403, { error: "Write API requires x-canary-write-token" });
          return;
        }
        const parsed = parseReplayRequest(await readJsonBody(request));
        store.replay(runId);
        const executed = hooks?.onReplay ? await hooks.onReplay(runId, parsed) : undefined;
        writeJson(
          response,
          200,
          parseReplayResponse({
            sourceRunId: runId,
            command: replayCommand(runId),
            mode: executed?.replayRunId ? "execution" : "command",
            replayRunId: executed?.replayRunId,
            events: store.eventLog(runId).length,
          }),
        );
        return;
      }
      if (parts[3] === "improvements") {
        if (request.method === "POST" && parts[4]) {
          if (!allowWrite(request, url, hooks)) {
            writeJson(response, 403, { error: "Write API requires x-canary-write-token" });
            return;
          }
          const decision = parseSuggestionDecision(await readJsonBody(request));
          const list = [...((run.improvements ?? []) as ImprovementSuggestion[])];
          const index = list.findIndex((item) => item.id === parts[4]);
          if (index < 0) {
            writeJson(response, 404, { error: "Suggestion not found" });
            return;
          }
          list[index] = decideSuggestion(list[index]!, decision.status);
          artifacts?.writeJson(runId, "improvement.json", list);
          store.update(runId, { improvements: list });
          if (decision.status === "verified" && artifacts) {
            writeRegressionDrafts(
              list.filter((item) => item.status === "verified"),
              resolveRegressionDir(resolveProjectRootFromArtifacts(artifacts.rootDir)),
            );
          }
          writeJson(response, 200, list[index]);
          return;
        }
        writeJson(response, 200, run.improvements ?? []);
        return;
      }
      if (parts[3] === "coverage") {
        writeJson(response, 200, run.coverage ? parseCoverageSummary(run.coverage, "GET coverage") : null);
        return;
      }
      if (parts[3] === "cases") {
        writeJson(response, 200, redactValue(run.results));
        return;
      }
      if (parts[3] === "trajectory") {
        const trajectoryId = parts[4];
        const payload = trajectoryId
          ? run.results.find((result) => result.trajectoryId === trajectoryId || result.trajectory?.id === trajectoryId)
              ?.trajectory
          : run.results.map((result) => result.trajectory);
        if (!payload) {
          writeJson(response, 404, { error: "Not found" });
          return;
        }
        writeJson(response, 200, redactValue(payload));
        return;
      }
      if (parts[3] === "report") {
        const format = parseReportFormat(parts[4] ?? "markdown");
        const body = renderReport(run, format);
        response.writeHead(200, {
          "content-type":
            format === "junit"
              ? "application/xml; charset=utf-8"
              : format === "json"
                ? "application/json"
                : "text/markdown; charset=utf-8",
        });
        response.end(body);
        return;
      }
      writeJson(response, 200, redactRunSnapshot(parseRunSnapshot(run, "GET /api/runs/:runId") as typeof run));
      return;
    }
    response.writeHead(404);
    response.end("Not found");
  } catch (error) {
    if (response.headersSent) response.destroy();
    else writeError(response, error);
  }
}

export { createControlServer, generateControlToken } from "./control-server.js";
