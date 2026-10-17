import { existsSync, lstatSync, readFileSync } from "node:fs";
import { relative, resolve, isAbsolute, join } from "node:path";
import {
  CLI_EXIT,
  ciResultSchema,
  type CiResult,
  type CliExitCode,
  type ProjectContext,
  type RunSnapshot,
} from "@canary/core";
import {
  listCheckpoints,
  readCheckpoint,
  writeCheckpoint,
  RunIsolationError,
  RunRecoveryError,
  type RunCheckpoint,
} from "@canary/runner";
import {
  ArtifactIntegrityError,
  ArtifactPrivacyError,
  FileArtifactRepository,
  redactValue,
  safeArtifactPath,
  sha256,
  writePrivateJson,
  CollectionBusyError,
  CollectionStorageError,
} from "@canary/trace";
import { resolveProjectContext } from "./home.js";
import { versionSnapshot } from "./diagnostics.js";
import type { CliOptions, RunCommandResult } from "./index.js";

export class CliFailure extends Error {
  constructor(
    readonly exitCode: CliExitCode,
    readonly code: string,
    message: string,
    readonly suggestion: string,
  ) {
    super(message);
  }
}
export function classifyCiError(error: unknown, context: ProjectContext): CliFailure {
  if (error instanceof CliFailure) return error;
  if(error instanceof CollectionStorageError)return new CliFailure(5,error.code,error.message,"Check artifact storage and its parent permissions; preserve existing evidence before retrying.");
  if (error instanceof CollectionBusyError) return new CliFailure(4,error.code,error.message,"Wait for collection maintenance, or inspect canary archive recover --json; preserve interrupted locks until their ownership is reviewed.");
  if (error instanceof ArtifactIntegrityError)
    return new CliFailure(
      5,
      error.code,
      error.message,
      "Preserve the run directory and inspect canary verify <runId> --json; do not regenerate hashes over damaged evidence.",
    );
  if (error instanceof ArtifactPrivacyError)
    return new CliFailure(
      6,
      error.code,
      error.message,
      "Review the redaction policy and retained privacy findings; preserve the failed or partial evidence before retrying.",
    );
  if (error instanceof RunIsolationError) {
    return new CliFailure(CLI_EXIT.environment, error.code, error.message, error.suggestion);
  }
  if (error instanceof RunRecoveryError) {
    const live = ["RUN_RECOVERY_LIVE_OWNER", "RUN_RECOVERY_UNPROVEN_PROCESS"].includes(error.code);
    return new CliFailure(
      live ? CLI_EXIT.environment : CLI_EXIT.artifact,
      error.code,
      live
        ? "Recovery is blocked by live or unproven process ownership."
        : "Retained recovery evidence failed validation.",
      "Preserve the checkpoint and inspect the original owner and evidence before retrying; do not remove locks or terminate processes using retained PIDs.",
    );
  }
  const fsError = error as { code?: string; path?: string } | null;
  if (
    fsError?.path &&
    ["EACCES", "EPERM", "ENOSPC", "ENOENT", "ENOTDIR", "EISDIR", "EROFS", "EIO", "EDQUOT", "EEXIST"].includes(
      fsError.code ?? "",
    )
  ) {
    const path = relative(context.artifactRoot, resolve(fsError.path));
    if (!isAbsolute(path) && path !== ".." && !path.startsWith("../") && !path.startsWith("..\\"))
      return new CliFailure(
        CLI_EXIT.artifact,
        "ARTIFACT_IO",
        "Cannot write or finalize local run artifacts.",
        "Check available disk space, permissions and file locks under the reported artifactRoot; preserve partial evidence.",
      );
  }
  // Never echo arbitrary exception text: config/import errors can contain secrets.
  return new CliFailure(
    CLI_EXIT.internal,
    "CANARY_INTERNAL",
    "Canary could not complete the run.",
    "Preserve local artifacts and reproduce with a minimal trusted configuration; report the Canary and Node versions.",
  );
}
const valueFlags = new Set([
  "--project",
  "--config",
  "--case",
  "--tag",
  "--repetitions",
  "--entry",
  "--retry-of",
  "--experience-check",
  "--base",
]);
const booleanFlags = new Set(["--ci", "--json", "--headless", "--no-open", "--agent-check", "--affected"]);
export function parseCiOptions(args: string[]): CliOptions {
  const options: CliOptions = { ci: true, headless: true, noOpen: true, suppressOutput: true };
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    if (booleanFlags.has(flag)) {
      if (flag === "--agent-check") options.agentCheck = true;
      if (flag === "--affected") options.affected = true;
      continue;
    }
    if (!valueFlags.has(flag))
      throw new CliFailure(
        2,
        "CLI_ARGUMENT",
        "Unsupported CI argument.",
        "Use canary help. CI accepts --config, --case, --tag, --entry and --repetitions; it never starts a Web server.",
      );
    const value = args[++i];
    if (!value || value.startsWith("--") || (seen.has(flag) && flag !== "--tag"))
      throw new CliFailure(
        2,
        "CLI_ARGUMENT",
        `Missing or repeated ${flag}.`,
        "Supply exactly one value per flag; only --tag may repeat.",
      );
    seen.add(flag);
    if (flag === "--config") options.configPath = value;
    if (flag === "--project") options.cwd = value;
    if (flag === "--case") options.caseId = value;
    if (flag === "--tag") (options.tags ??= []).push(value);
    if (flag === "--entry") options.entry = value;
    if (flag === "--retry-of") options.retryOf = value;
    if (flag === "--base") options.baseRef = value;
    if (flag === "--experience-check") {
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value))
        throw new CliFailure(2, "CLI_ARGUMENT", "Invalid internal check ID.", "Use a declared project check ID.");
      options.experienceContext = { checkId: value, checkType: "agent" };
    }
    if (flag === "--repetitions") {
      const count = Number(value);
      if (!Number.isSafeInteger(count) || count < 1)
        throw new CliFailure(
          2,
          "CLI_ARGUMENT",
          "--repetitions must be a positive safe integer.",
          "Use --repetitions 1 or a positive integer within your test budget.",
        );
      options.repetitions = count;
    }
  }
  if (options.experienceContext && !options.agentCheck)
    throw new CliFailure(
      2,
      "CLI_ARGUMENT",
      "Check context requires a project agent check.",
      "Run the project configuration instead.",
    );
  return options;
}

interface InterruptedEvidence {
  checkpoint: RunCheckpoint;
  snapshot: RunSnapshot;
  runHash: string;
  integrity: "partial" | "verified";
  manifestHash?: string;
}
/** A PID alone cannot distinguish an earlier or concurrent invocation in this process. */
function associateInterruptedEvidence(
  context: ProjectContext,
  existing: Set<string> | undefined,
): InterruptedEvidence | undefined {
  if (!existing) return undefined;
  const candidates = listCheckpoints(context.artifactRoot).filter(
    (checkpoint) =>
      checkpoint.pid === process.pid &&
      !existing.has(checkpoint.runId) &&
      ["running", "finalizing", "interrupted", "failed", "cancelled"].includes(checkpoint.status),
  );
  // Ambiguous invocations must not acquire authority over each other's retained evidence.
  if (candidates.length !== 1) return undefined;
  const checkpoint = candidates[0]!,
    repository = new FileArtifactRepository(context.artifactRoot);
  const integrity = repository.verify(checkpoint.runId);
  if (integrity.status !== "partial" && integrity.status !== "verified") return undefined;
  const file = safeArtifactPath(checkpoint.artifactDir, "run.json"),
    stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 16_777_216) return undefined;
  const runHash = sha256(readFileSync(file)),
    snapshot = repository.readRun(checkpoint.runId);
  if (
    !snapshot ||
    snapshot.runId !== checkpoint.runId ||
    snapshot.startedAt !== checkpoint.startedAt ||
    !["idle", "running", "failed", "cancelled"].includes(snapshot.status) ||
    (integrity.status === "verified" &&
      (snapshot.status !== "failed" ||
        checkpoint.status !== "failed" ||
        !snapshot.finishedAt ||
        !Number.isFinite(Date.parse(snapshot.finishedAt)))) ||
    ![snapshot.totalCases, snapshot.completedCases, snapshot.passedCases].every(
      (count) => Number.isSafeInteger(count) && count >= 0,
    ) ||
    snapshot.passedCases > snapshot.completedCases ||
    snapshot.completedCases > snapshot.totalCases ||
    snapshot.results.some(
      (result) =>
        result.runId !== checkpoint.runId ||
        !checkpoint.completedCaseKeys.includes(
          result.repetition ? `${result.caseId}#${result.repetition}` : result.caseId,
        ),
    ) ||
    snapshot.checks?.some((check) => !checkpoint.completedCaseKeys.includes(check.id)) ||
    sha256(readFileSync(file)) !== runHash ||
    JSON.stringify(readCheckpoint(checkpoint.artifactDir)) !== JSON.stringify(checkpoint)
  )
    return undefined;
  const finalIntegrity = repository.verify(checkpoint.runId);
  if (finalIntegrity.status !== integrity.status || finalIntegrity.manifestHash !== integrity.manifestHash)
    return undefined;
  return { checkpoint, snapshot, runHash, integrity: integrity.status, manifestHash: integrity.manifestHash };
}

export async function executeCi(
  args: string[],
  run: (options: CliOptions) => Promise<RunCommandResult>,
): Promise<CiResult> {
  let context = resolveProjectContext();
  let result: RunCommandResult | undefined;
  let failure: CliFailure | undefined;
  let exitCode: CliExitCode = CLI_EXIT.internal;
  const controller = new AbortController();
  const stop = (): void => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  let interrupted: InterruptedEvidence | undefined;
  let existingCheckpoints: Set<string> | undefined;
  let secondaryFailure: CliFailure | undefined;
  try {
    const options = parseCiOptions(args);
    context = resolveProjectContext(options);
    if (Number(process.versions.node.split(".")[0]) < 24)
      throw new CliFailure(
        4,
        "NODE_UNSUPPORTED",
        "Node 24 or later is required.",
        "Run this CLI with the documented Node runtime.",
      );
    try {
      existingCheckpoints = new Set(listCheckpoints(context.artifactRoot).map((checkpoint) => checkpoint.runId));
    } catch {
      /* A corrupt checkpoint cannot grant association authority or mask the runner's outcome. */
    }
    result = await run({ ...options, signal: controller.signal });
    exitCode = result.exitCode as CliExitCode;
  } catch (error) {
    failure = classifyCiError(error, context);
    if (controller.signal.aborted && failure.code === "CANARY_INTERNAL")
      failure = new CliFailure(
        CLI_EXIT.interrupted,
        "RUN_INTERRUPTED",
        "The requested run was interrupted.",
        "Inspect the retained partial evidence before retrying the run.",
      );
    exitCode = failure.exitCode;
    try {
      interrupted = associateInterruptedEvidence(context, existingCheckpoints);
      if (interrupted?.integrity === "partial" && ["running", "finalizing"].includes(interrupted.checkpoint.status)) {
        // This invocation has stopped, but its process remains alive. Retain partial evidence;
        // recovery, workspace removal and recorded PID signalling are separate operations.
        writeCheckpoint({
          ...interrupted.checkpoint,
          status: "interrupted",
          termination:
            controller.signal.aborted || failure.exitCode === CLI_EXIT.interrupted
              ? "cancelled"
              : (interrupted.checkpoint.termination ?? "error"),
        });
        interrupted.checkpoint = readCheckpoint(interrupted.checkpoint.artifactDir)!;
      }
    } catch {
      /* Keep the original classified failure; checkpoint inspection must not replace it. */
    }
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    try {
      await result?.close();
    } catch (error) {
      failure = classifyCiError(error, context);
      exitCode = failure.exitCode;
    }
  }
  const payload = (): CiResult =>
    ciResultSchema.parse({
      v: 1,
      kind: "canary.ci",
      mode: "ci",
      context,
      exitCode,
      outcome: exitCode === 0 ? "passed" : exitCode === 1 ? "failed" : exitCode === 3 ? "interrupted" : "error",
      runId: result?.runId ?? interrupted?.checkpoint.runId ?? null,
      artifactPath: result?.artifactPath ?? (interrupted ? join(interrupted.checkpoint.artifactDir, "run.json") : null),
      summary: {
        total: result?.snapshot.totalCases ?? interrupted?.snapshot.totalCases ?? 0,
        passed: result?.snapshot.passedCases ?? interrupted?.snapshot.passedCases ?? 0,
        failed:
          (result?.snapshot.checks ?? interrupted?.snapshot.checks)?.filter(
            (check) => check.status === "failed" || check.status === "blocked",
          ).length ?? (result?.snapshot.results ?? interrupted?.snapshot.results ?? []).filter((r) => !r.passed).length,
      },
      issues: failure
        ? [failure, ...(secondaryFailure ? [secondaryFailure] : [])].map((issue) => ({
            code: issue.code,
            severity: "error",
            message: issue.message,
            suggestion: issue.suggestion,
          }))
        : exitCode === 0
          ? []
          : [
              {
                code: exitCode === 3 ? "RUN_INTERRUPTED" : exitCode === 6 ? "POLICY_GATE" : "CHECK_FAILED",
                severity: "error",
                message: "The configured run did not pass.",
                suggestion:
                  "Inspect the local run.json and report.xml; correct the failing case or environment before re-running.",
              },
            ],
      ...(result?.selection ? { selection: result.selection } : {}),
      runtime: versionSnapshot(),
      capabilities: {
        scope: (result?.snapshot.checks ?? interrupted?.snapshot.checks) ? "project-checks" : "configured-agent-cases",
        web: false,
        automaticExport: false,
      },
    });
  const envelopeRunId = result?.runId ?? interrupted?.checkpoint.runId;
  if (envelopeRunId) {
    try {
      if (!existsSync(join(context.artifactRoot, envelopeRunId)))
        throw new CliFailure(
          5,
          "ARTIFACT_IO",
          "Run artifact directory is missing.",
          "Preserve partial evidence and inspect the reported artifactRoot.",
        );
      if (interrupted && !result) {
        const dir = interrupted.checkpoint.artifactDir,
          repository = new FileArtifactRepository(context.artifactRoot),
          integrity = repository.verify(envelopeRunId);
        if (
          JSON.stringify(readCheckpoint(dir)) !== JSON.stringify(interrupted.checkpoint) ||
          sha256(readFileSync(safeArtifactPath(dir, "run.json"))) !== interrupted.runHash ||
          integrity.status !== interrupted.integrity ||
          integrity.manifestHash !== interrupted.manifestHash
        )
          throw new CliFailure(
            5,
            "CI_ENVELOPE_CHANGED",
            "Run evidence changed before its CI envelope could be recorded.",
            "Preserve the run directory and inspect its original checkpoint; retry after the writer finishes.",
          );
        if (interrupted.integrity === "partial") {
          // Do not seal incomplete bytes or add recovery lineage while the owner is still live.
          writePrivateJson(safeArtifactPath(dir, "ci.json"), payload());
        } else repository.writeJson(envelopeRunId, "ci.json", payload());
      } else new FileArtifactRepository(context.artifactRoot).writeJson(envelopeRunId, "ci.json", payload());
    } catch (error) {
      const envelopeFailure = classifyCiError(error, context);
      if (failure) secondaryFailure = envelopeFailure;
      else {
        failure = envelopeFailure;
        exitCode = failure.exitCode;
      }
    }
  }
  return payload();
}

/** CLI-only console redirection. Config modules are trusted code, not an OS sandbox. */
export async function printCiResult(
  args: string[],
  run: (options: CliOptions) => Promise<RunCommandResult>,
): Promise<number> {
  const original = {
    log: console.log,
    info: console.info,
    debug: console.debug,
    warn: console.warn,
    error: console.error,
  };
  const diagnostic = (...values: unknown[]): void => {
    original.error(...values.map((value) => redactValue(value)));
  };
  console.log = console.info = console.debug = console.warn = console.error = diagnostic;
  let result: CiResult;
  try {
    result = await executeCi(args, run);
  } finally {
    Object.assign(console, original);
  }
  original.log(JSON.stringify(result));
  return result.exitCode;
}
