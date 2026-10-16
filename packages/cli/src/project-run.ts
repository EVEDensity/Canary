import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, rmSync } from "node:fs";
import { join, resolve, relative } from "node:path";
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
import { buildStructure, compareStructure, analyzeArchitecture, analyzeImpact, planAffectedChecks } from "@canary/structure";
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
import { evaluateBehaviorContracts } from "./change-verification.js";
import type { CliOptions, RunCommandResult } from "./index.js";
import { executionSourceProof, trySourceFingerprint } from "./source-identity.js";

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
    if (!existsSync(context.configFile)) discovery = { ...discovery, automaticExecution: true, reason: "Executing automatic checks from project declarations; the sealed check plan records the exact commands." };
    sources = projectSourceInventory(context.projectRoot);
  } catch {
    throw new CliFailure(
      2,
      "PROJECT_PREFLIGHT_BLOCKED",
      "Cannot read project markers or inventory sources within the supported bounds.",
      "Inspect readable source files: at most 10,000 files, 16 MiB each and 256 MiB total; dependency/build directories are excluded.",
    );
  }
  let structure: ReturnType<typeof buildStructure>;
  let structureChange: ReturnType<typeof compareStructure> | undefined;
  try {
    structure = buildStructure(context.projectRoot);
    structureChange = options.baseRef ? compareStructure(context.projectRoot, structure, options.baseRef) : undefined;
  } catch {
    throw new CliFailure(2, "STRUCTURE_PREFLIGHT_BLOCKED", "Cannot capture a consistent project structure.", "Check canary.architecture.json, the Git --base ref and the documented source limits; retry if files changed during scanning.");
  }
  structure.source.runId = runId;
  const analysis = analyzeArchitecture(structure), impact = analyzeImpact(structure, structureChange);
  const originalConfig = config;
  const declaredGate = config.contracts?.some((contract) => contract.required);
  const ciPlan = planAffectedChecks(structure, impact, config.checks, Boolean(options.affected && !session?.lineage?.retryOf && !declaredGate), [relative(context.projectRoot, context.configFile).replaceAll("\\", "/")]);
  if (options.affected && declaredGate) ciPlan.fallbackReasons.push("Declared behavior contracts require full verification scope");
  const selectedIds = new Set(ciPlan.checks.filter((check) => check.action === "run").map((check) => check.id));
  config = { ...config, checks: config.checks.filter((check) => selectedIds.has(check.id)), ...(config.contracts ? { contracts: config.contracts.filter((contract) => selectedIds.has(contract.checkId)) } : {}) };
  const evidence = recordEvidence(config, context, [], session?.lineage ?? {}, stableHash(sources), options.executionEnv);
  const selection = { requested: ciPlan.requested, mode: ciPlan.mode, planned: ciPlan.checks.length, selected: ciPlan.selectedCount, omitted: ciPlan.omittedCount, fallbackReasons: ciPlan.fallbackReasons };
  store.update(runId, { totalCases: config.checks.length, checkSelection: { ...selection, omittedChecks: ciPlan.checks.filter((check) => check.action === "omit").map(({ id, reason }) => ({ id, reason })) }, evidence, checks, ...(session?.lineage?.retryOf ? { retryOf: session.lineage.retryOf } : {}) });
  beginArtifacts(artifactDir, session?.lineage);
  writePrivateJson(join(artifactDir, "structure.json"), structure, privacy);
  if (structureChange) writePrivateJson(join(artifactDir, "structure-change.json"), structureChange, privacy);
  writePrivateJson(join(artifactDir, "architecture-analysis.json"), analysis, privacy);
  writePrivateJson(join(artifactDir, "change-impact.json"), impact, privacy);
  writePrivateJson(join(artifactDir, "ci-plan.json"), ciPlan, privacy);
  writePrivateJson(join(artifactDir, "ci-original-plan.json"), originalConfig, privacy);
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
  let executionSource: ReturnType<typeof trySourceFingerprint>;
  try {
    persist();
    checkpoint("running");
    writePrivateJson(join(artifactDir, "source-inventory.json"), sources, privacy);
    writePrivateJson(join(artifactDir, "discovery.json"), discovery, privacy);
    writePrivateJson(join(artifactDir, "check-plan.json"), config, privacy);
    executionSource = trySourceFingerprint(context.projectRoot);
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
              environment: options.executionEnv,
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
          dependsOn: check.dependsOn,
          type: check.type,
          version: check.version,
          required: check.required || Boolean(session?.lineage?.retryOf),
          evidence: outcome.status === "excluded" ? "excluded" : outcome.status === "blocked" ? "blocked" : "verified",
          retryable: ["timeout", "environment"].includes(outcome.category),
          durationMs: Math.round(monotonicNow() - started),
          cwd,
          envAllowlist: Object.keys(checkEnvironment(check, workspace, options.executionEnv)).sort(),
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
    const contracts = evaluateBehaviorContracts(config, checks);
    if (contracts.length) {
      writePrivateJson(join(artifactDir, "behavior-contracts.json"), { v: 1, kind: "canary.behavior-contracts", contracts }, privacy);
      const violations = contracts.filter((contract) => contract.required && contract.status !== "verified");
      if (violations.length) {
        if (exitCode === 0) exitCode = violations.some((contract) => contract.status === "unknown") ? 6 : 1;
        store.update(runId, { gate: { passed: false, reason: "hard_gate_failed", failureCategory: "policy_violation", failures: violations.map((contract) => ({ code: "policy_violation", target: contract.id, status: contract.status, message: `Declared behavior contract ${contract.id}: ${contract.status}` })) } });
      }
    }
    store.finish(runId, exitCode === 0 ? "completed" : exitCode === 3 ? "cancelled" : "failed");
    store.update(runId, { evidence: { ...evidence, conclusionHash: conclusionHash(store.get(runId)!) } });
    persist();
    writeReports();
    checkpoint(exitCode === 0 ? "completed" : exitCode === 3 ? "cancelled" : "failed");
  } finally {
    await cleanup();
  }
  const observedSource = trySourceFingerprint(context.projectRoot);
  writePrivateJson(join(artifactDir, "execution-source.json"), executionSourceProof(store.get(runId)!, executionSource, observedSource), privacy);
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
    selection,
    close: async () => {},
  };
}
