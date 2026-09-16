import { existsSync, renameSync, writeFileSync, unlinkSync } from "node:fs";
import { relative, resolve, isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { CLI_EXIT, ciResultSchema, type CiResult, type CliExitCode, type ProjectContext, type RunSnapshot } from "@canary/core";
import { findCheckpointForPid, recoverPartialRun, RunIsolationError } from "@canary/runner";
import { FileArtifactRepository, redactValue } from "@canary/trace";
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
  if (error instanceof RunIsolationError) {
    return new CliFailure(
      CLI_EXIT.environment,
      error.code,
      error.message,
      error.suggestion,
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
const valueFlags = new Set(["--config", "--case", "--tag", "--repetitions", "--entry"]);
const booleanFlags = new Set(["--ci", "--json", "--headless", "--no-open"]);
export function parseCiOptions(args: string[]): CliOptions {
  const options: CliOptions = { ci: true, headless: true, noOpen: true, suppressOutput: true };
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    if (booleanFlags.has(flag)) continue;
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
    if (flag === "--case") options.caseId = value;
    if (flag === "--tag") (options.tags ??= []).push(value);
    if (flag === "--entry") options.entry = value;
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
  return options;
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
  let recoveredRunId: string | null = null;
  let recoveredArtifactPath: string | null = null;
  let recoveredSnapshot: RunSnapshot | undefined;
  try {
    const options = parseCiOptions(args);
    context = resolveProjectContext(options);
    if (Number(process.versions.node.split(".")[0]) < 22)
      throw new CliFailure(
        4,
        "NODE_UNSUPPORTED",
        "Node 22 or later is required.",
        "Run this CLI with the documented Node runtime.",
      );
    result = await run({ ...options, signal: controller.signal });
    exitCode = result.exitCode as CliExitCode;
  } catch (error) {
    failure = classifyCiError(error, context);
    exitCode = failure.exitCode;
    const found = findCheckpointForPid(context.artifactRoot, process.pid);
    if (found) {
      try {
        const repository = new FileArtifactRepository(context.artifactRoot);
        const recovered = await recoverPartialRun(found.artifactDir, repository.readRun(found.runId));
        recoveredRunId = found.runId;
        recoveredArtifactPath = join(found.artifactDir, "run.json");
        recoveredSnapshot = recovered.snapshot;
      } catch {
        /* Keep the original classified failure; partial recovery must not mask it. */
      }
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
      runId: result?.runId ?? recoveredRunId,
      artifactPath: result?.artifactPath ?? recoveredArtifactPath,
      summary: {
        total: result?.snapshot.totalCases ?? recoveredSnapshot?.totalCases ?? 0,
        passed: result?.snapshot.passedCases ?? recoveredSnapshot?.passedCases ?? 0,
        failed: (result?.snapshot.results ?? recoveredSnapshot?.results ?? []).filter((r) => !r.passed).length,
      },
      issues: failure
        ? [{ code: failure.code, severity: "error", message: failure.message, suggestion: failure.suggestion }]
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
      runtime: versionSnapshot(),
      capabilities: { scope: "configured-agent-cases", web: false, automaticExport: false },
    });
  const envelopeRunId = result?.runId ?? recoveredRunId;
  if (envelopeRunId) {
    const target = resolve(context.artifactRoot, envelopeRunId, "ci.json");
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(payload(), null, 2), { encoding: "utf8", flag: "wx" });
      renameSync(temporary, target);
    } catch (error) {
      failure = classifyCiError(error, context);
      exitCode = failure.exitCode;
    } finally {
      if (existsSync(temporary)) {
        try {
          unlinkSync(temporary);
        } catch {
          /* Retain inaccessible partial evidence. */
        }
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
