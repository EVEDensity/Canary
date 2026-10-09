import { randomUUID } from "node:crypto";
import type { ProjectChecksConfig, ProjectContext, RunLineage } from "@canary/core";
import { FileArtifactRepository, RunStore, stableHash } from "@canary/trace";
import { CliFailure } from "./ci.js";
import type { CliOptions, RunCommandResult } from "./index.js";
import { runProjectChecks } from "./project-run.js";

/** Fresh dependencies are rerun too; old passes are never silently reused. */
export function selectProjectChecks(config: ProjectChecksConfig, ids: string[]): ProjectChecksConfig {
  if (!ids.length || ids.some((id) => !config.checks.some((check) => check.id === id)))
    throw new Error("No matching checks to rerun");
  const selected = new Set<string>();
  const add = (id: string): void => {
    if (selected.has(id)) return;
    selected.add(id);
    config.checks.find((check) => check.id === id)!.dependsOn.forEach(add);
  };
  ids.forEach(add);
  return { ...config, checks: config.checks.filter((check) => selected.has(check.id)), ...(config.contracts ? { contracts: config.contracts.filter((contract) => selected.has(contract.checkId)) } : {}) };
}

export async function runProjectSession(
  config: ProjectChecksConfig,
  context: ProjectContext,
  options: CliOptions,
  runAgent: Parameters<typeof runProjectChecks>[3],
  open: (url: string) => void,
): Promise<RunCommandResult> {
  if (options.ci || options.headless || options.json || config.web?.enabled === false)
    return runProjectChecks(config, context, options, runAgent);
  const port = options.port ?? config.web?.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new CliFailure(
      2,
      "PORT_INVALID",
      "Port must be an integer between 0 and 65535.",
      "Use --port 0 for an available port.",
    );
  const { createWebServer } = await import("@canary/web");
  const store = new RunStore(),
    repository = new FileArtifactRepository(context.artifactRoot);
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const stop = (): void => {
    controller.abort();
    void close().catch(() => {});
  };
  const detach = (): void => {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  };
  let busy = true,
    closed = false;
  const firstId = `run_${randomUUID()}`;
  store.create(config.checks.length, firstId);
  store.update(firstId, { checks: [] });
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (closing) return closing;
    closed = true;
    if (!busy) detach();
    closing = new Promise<void>((done, fail) => {
      if (!web.server.listening) {
        done();
        return;
      }
      web.server.close((error) => (error ? fail(error) : done()));
      web.server.closeAllConnections();
    });
    return closing;
  };
  const execute = async (
    selected: ProjectChecksConfig,
    runId: string,
    lineage?: RunLineage,
  ): Promise<RunCommandResult> => {
    try {
      return await runProjectChecks(selected, context, { ...options, signal, suppressOutput: true }, runAgent, {
        store,
        runId,
        lineage,
      });
    } catch (error) {
      if (store.get(runId)) {
        store.finish(runId, "failed");
        store.reportError(runId, "Run failed; inspect local evidence.");
      }
      throw error;
    } finally {
      busy = false;
      if (closed) detach();
    }
  };
  const web = createWebServer(store, config.web?.host ?? "127.0.0.1", port, context.artifactRoot, {
    projectPage: true,
    writeToken: randomUUID(),
    onClose: () => {
      setImmediate(() => {
        void close().catch(() => {});
      });
    },
    onRetry: async (sourceId, request) => {
      if (closed || busy) throw new Error("A run is active or this page session is closed");
      const integrity = repository.verify(sourceId);
      if (integrity.status !== "verified") throw new Error("Only sealed, verified runs can be retried");
      const source = repository.readRun(sourceId);
      if (!source?.checks || source.status === "running") throw new Error("Project run unavailable");
      const prior = repository.readJson<ProjectChecksConfig>(sourceId, "check-plan.json");
      const priorIds = new Set(prior?.checks.map((check) => check.id));
      if (
        !prior ||
        source.evidence?.reproduction.configHash !==
          stableHash({ ...config, checks: config.checks.filter((check) => priorIds.has(check.id)) })
      )
        throw new Error("Check configuration changed; start a new session");
      const ids = request.checkId
        ? [request.checkId]
        : source.checks
            .filter((check) => check.status === "failed" || check.status === "blocked")
            .map((check) => check.id);
      if (ids.some((id) => !source.checks!.some((check) => check.id === id)))
        throw new Error("Check is not in the source run");
      const selected = selectProjectChecks(config, ids),
        runId = `run_${randomUUID()}`;
      busy = true;
      store.create(selected.checks.length, runId);
      store.update(runId, { checks: [], retryOf: sourceId });
      void execute(selected, runId, { retryOf: sourceId, parentManifestHash: integrity.manifestHash }).catch(() => {});
      return { runId };
    },
  });
  let uiUrl: string;
  try {
    uiUrl = `${(await web.listen()).url}/?runId=${firstId}`;
  } catch {
    throw new CliFailure(
      4,
      "WEB_LISTEN_FAILED",
      "Cannot listen on the requested loopback port.",
      "Choose a free port or use --headless.",
    );
  }
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  if (!options.suppressOutput) console.log(`runId: ${firstId}\ncanary UI: ${uiUrl}`);
  if (!options.noOpen && config.web?.open !== false) open(uiUrl);
  try {
    const result = await execute(config, firstId);
    if (!options.suppressOutput)
      console.log(`status: ${result.snapshot.status}\nartifact: ${result.artifactPath}\nexit: ${result.exitCode}`);
    return { ...result, uiUrl, close };
  } catch (error) {
    await close();
    throw error;
  }
}
