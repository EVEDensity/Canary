import { randomUUID } from "node:crypto";
import { lstatSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ProjectChecksConfig, ProjectCheckResult, ProjectContext, RunSnapshot, RunLineage } from "@canary/core";
import {
  ArtifactPrivacyError,
  beginArtifacts,
  sealArtifacts,
  writePrivateJson,
  writePrivateText,
  collectSecretValues,
  RunStore,
  stableHash,
  FileArtifactRepository,
} from "@canary/trace";
import { createExecutionWorkspace, writeCheckpoint, recoverStaleRuns } from "@canary/runner";
import { renderReport } from "@canary/reporters";
import {
  blocked,
  checkEnvironment,
  CheckPathError,
  executeCheck,
  monotonicNow,
  projectPath,
  type CheckOutcome,
} from "./check-executor.js";
import { discoverProject, projectSourceInventory } from "./discovery.js";
import { recordEvidence, conclusionHash } from "./evidence.js";
import { CliFailure } from "./ci.js";
import type { CliOptions, RunCommandResult } from "./index.js";

export async function runProjectChecks(
  config: ProjectChecksConfig,
  context: ProjectContext,
  options: CliOptions,
  runAgent: (
    config: string,
    signal: AbortSignal,
    env: NodeJS.ProcessEnv,
    onPid: (pid: number) => void,
    checkId: string,
  ) => Promise<CheckOutcome>,
  session?: { store: RunStore; runId: string; lineage?: RunLineage },
): Promise<RunCommandResult> {
  if (
    options.entry ||
    options.caseId ||
    options.caseIds?.length ||
    options.tags?.length ||
    options.repetitions ||
    options.retryOf ||
    options.replayOf ||
    options.candidateOf
  )
    throw new CliFailure(
      2,
      "PROJECT_SELECTOR_UNSUPPORTED",
      "Agent selectors and lineage flags cannot select project checks.",
      "Use a project configuration with explicit checks; retry orchestration belongs to a later stage.",
    );
  const repository = new FileArtifactRepository(context.artifactRoot);
  await recoverStaleRuns(context.artifactRoot, (id) => repository.readRun(id));
  const runId = session?.runId ?? `run_${randomUUID()}`;
  const artifactDir = join(context.artifactRoot, runId);
  const store = session?.store ?? new RunStore();
  const privacy = { secretValues: collectSecretValues(config) };
  store.setPrivacy(privacy);
  store.create(config.checks.length, runId);
  const checks: ProjectCheckResult[] = [];
  let sources;
  let discovery;
  try {
    discovery = discoverProject(context.projectRoot);
    sources = projectSourceInventory(context.projectRoot);
  } catch {
    throw new CliFailure(
      2,
      "PROJECT_PREFLIGHT_BLOCKED",
      "Cannot read project markers or inventory sources within the supported bounds.",
      "Inspect readable source files: at most 10,000 files, 16 MiB each and 256 MiB total; dependency/build directories are excluded.",
    );
  }
  const evidence = recordEvidence(config, context, [], session?.lineage ?? {}, stableHash(sources));
  store.update(runId, { evidence, checks, ...(session?.lineage?.retryOf ? { retryOf: session.lineage.retryOf } : {}) });
  beginArtifacts(artifactDir, session?.lineage);
  const workspace = createExecutionWorkspace({ artifactDir, runId });
  const start = monotonicNow();
  const checkpoint = (status: "running" | "completed" | "failed" | "cancelled") => {
    writeCheckpoint({
      v: 1,
      kind: "canary.checkpoint",
      runId,
      pid: process.pid,
      status,
      startedAt: store.get(runId)!.startedAt,
      updatedAt: new Date().toISOString(),
      artifactDir,
      tmpDir: workspace.tmpDir,
      workDir: workspace.workDir,
      lockPath: workspace.lockPath,
      ports: [],
      childPids: [...workspace.childPids],
      completedCaseKeys: checks.map((check) => check.id),
      pendingCaseKeys: config.checks
        .filter((check) => !checks.some((result) => result.id === check.id))
        .map((check) => check.id),
    });
  };
  const persist = () => {
    store.update(runId, {
      checks: store.sanitize(checks),
      completedCases: checks.length,
      passedCases: checks.filter((check) => check.status === "passed").length,
    });
    writePrivateJson(join(artifactDir, "run.json"), store.get(runId), privacy);
    writePrivateJson(join(artifactDir, "checks.json"), { v: 1, kind: "canary.checks", checks }, privacy);
  };
  const writeReports = () => {
    const snapshot = store.get(runId)!;
    for (const [format, name] of [
      ["json", "report.json"],
      ["junit", "report.xml"],
      ["markdown", "report.md"],
    ] as const)
      writePrivateText(join(artifactDir, name), renderReport(snapshot, format), privacy);
  };
  const cleanup = async () => {
    await workspace.release();
    if (workspace.childPids.length)
      throw new CliFailure(
        4,
        "CHECK_CLEANUP_FAILED",
        "A check process could not be reclaimed.",
        "Preserve the partial artifact and inspect checkpoint child PIDs.",
      );
    for (const path of [workspace.tmpDir, workspace.workDir]) {
      if (resolve(path, "..") !== resolve(artifactDir) || lstatSync(path).isSymbolicLink())
        throw new CliFailure(
          6,
          "CHECK_WORKSPACE_INVALID",
          "Check workspace path changed.",
          "Preserve the partial evidence for inspection.",
        );
      rmSync(path, { recursive: true, force: true });
    }
  };
  let exitCode: number;
  try {
    persist();
    checkpoint("running");
    writePrivateJson(join(artifactDir, "source-inventory.json"), sources, privacy);
    writePrivateJson(join(artifactDir, "discovery.json"), discovery, privacy);
    writePrivateJson(join(artifactDir, "check-plan.json"), config, privacy);
    for (const check of config.checks) {
      store.update(runId, { activeCheck: { id: check.id, startedAt: new Date().toISOString() } });
      const started = monotonicNow();
      let cwd = resolve(context.projectRoot, check.cwd);
      let outcome: CheckOutcome;
      const remaining = config.budgetMs - (started - start);
      if (options.signal?.aborted) outcome = blocked(3, "cancelled");
      else if (remaining <= 0) outcome = blocked(3, "budget");
      else if (check.platforms && !check.platforms.includes(process.platform as "win32" | "linux" | "darwin"))
        outcome = { status: "excluded", exitCode: 0, category: "platform" };
      else if (check.dependsOn.some((id) => checks.find((result) => result.id === id)?.status !== "passed"))
        outcome = blocked(1, "dependency");
      else {
        const controller = new AbortController();
        const cancel = () => controller.abort();
        options.signal?.addEventListener("abort", cancel, { once: true });
        let timedOut = false;
        const timer = setTimeout(
          () => {
            timedOut = true;
            controller.abort();
          },
          Math.min(check.timeoutMs, remaining),
        );
        try {
          cwd = projectPath(context.projectRoot, check.cwd);
          if (!lstatSync(cwd).isDirectory()) outcome = blocked(2, "configuration");
          else
            outcome = await executeCheck(check, {
              root: context.projectRoot,
              cwd,
              workspace,
              signal: controller.signal,
              onPid: (pid) => {
                workspace.recordChildPid(pid);
                checkpoint("running");
              },
              runAgent,
            });
        } catch (error) {
          const code = (error as NodeJS.ErrnoException)?.code;
          outcome = controller.signal.aborted
            ? blocked(3, "cancelled")
            : error instanceof CheckPathError
              ? blocked(6, "policy")
              : ["ENOENT", "ENOTDIR", "ERR_INVALID_ARG_VALUE"].includes(code ?? "")
                ? blocked(2, "configuration")
                : ["EACCES", "EPERM", "EIO"].includes(code ?? "")
                  ? blocked(4, "environment")
                  : blocked(10, "internal");
        } finally {
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", cancel);
        }
        if (timedOut) outcome = { ...outcome, ...blocked(3, remaining <= check.timeoutMs ? "budget" : "timeout") };
        else if (options.signal?.aborted) outcome = { ...outcome, ...blocked(3, "cancelled") };
      }
      checks.push(
        store.sanitize({
          ...outcome,
          outputTruncated:
            outcome.outputTruncated || (outcome.stdout?.length ?? 0) > 2048 || (outcome.stderr?.length ?? 0) > 2048,
          id: check.id,
          type: check.type,
          version: check.version,
          required: check.required || Boolean(session?.lineage?.retryOf),
          evidence: outcome.status === "excluded" ? "excluded" : outcome.status === "blocked" ? "blocked" : "verified",
          retryable: ["timeout", "environment"].includes(outcome.category),
          durationMs: Math.round(monotonicNow() - started),
          cwd,
          envAllowlist: Object.keys(checkEnvironment(check, workspace)).sort(),
        }),
      );
      persist();
      checkpoint("running");
    }
    store.update(runId, { activeCheck: undefined });
    const required = checks.filter((check) => (check.required || session?.lineage?.retryOf) && check.status !== "excluded");
    // Operational/privacy failures are global even for optional checks; ordinary optional assertions do not fail CI.
    const codes = checks.filter((check) => check.required || session?.lineage?.retryOf || check.exitCode > 1).map((check) => check.exitCode);
    exitCode = [6, 5, 3, 4, 10, 2, 1].find((code) => codes.includes(code)) ?? (required.length ? 0 : 2);
    store.finish(runId, exitCode === 0 ? "completed" : exitCode === 3 ? "cancelled" : "failed");
    store.update(runId, { evidence: { ...evidence, conclusionHash: conclusionHash(store.get(runId)!) } });
    persist();
    writeReports();
    checkpoint(exitCode === 0 ? "completed" : exitCode === 3 ? "cancelled" : "failed");
  } finally {
    await cleanup();
  }
  try {
    sealArtifacts(artifactDir, { privacy });
  } catch (error) {
    if (error instanceof ArtifactPrivacyError) {
      store.finish(runId, "failed");
      store.update(runId, { evidence: { ...evidence, privacyFailure: true } });
      persist();
      writeReports();
      checkpoint("failed");
    }
    throw error;
  }
  const snapshot: RunSnapshot = store.get(runId)!;
  if (!options.suppressOutput) console.log(options.json ? JSON.stringify(snapshot) : renderReport(snapshot, "console"));
  return {
    exitCode,
    runId,
    artifactPath: join(artifactDir, "run.json"),
    uiUrl: "",
    store,
    snapshot,
    close: async () => {},
  };
}
