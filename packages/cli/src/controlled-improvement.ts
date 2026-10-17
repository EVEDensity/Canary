import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  isRepairTaskPath,
  parseCanaryConfig,
  parseImprovementPlan,
  parseTestCase,
  qualityContentHash,
  type CanaryConfig,
  type ImprovementAuthorization,
  type ImprovementAttempt,
  type ImprovementAttemptResult,
  type ImprovementPlan,
  type ImprovementSession,
  type ProjectContext,
  type RunSnapshot,
  type TestCase,
} from "@canary/core";
import { measureControlledBenefit } from "@canary/improvement";
import { createRunnerPorts, killProcessTree, type RunnerPorts } from "@canary/runner";
import {
  FileArtifactRepository,
  RunStore,
  ControlledImprovementError,
  QualityAssessmentError,
  createImprovementSession,
  executeImprovementSession,
  readImprovementSession,
  readQualityAssessment,
  readSealedQualityRun,
  sha256,
} from "@canary/trace";
import { runEvaluation } from "./app.js";
import { projectSourceInventory } from "./discovery.js";
import { resolveProjectContext } from "./home.js";

class ImprovementInputError extends Error {}
function input(message: string): never {
  throw new ImprovementInputError(message);
}
const hash = (value: unknown) => qualityContentHash(value);
const supportedAssertions = new Set([
  "output.exists",
  "trajectory.required_event",
  "trajectory.forbidden_event",
  "trajectory.max_steps",
  "trajectory.max_tool_calls",
  "execution.termination",
  "trajectory.error_recovery",
  "execution.max_latency",
  "execution.max_budget",
  "feature.expected",
  "coverage.atLeast",
  "tool.called",
  "tool.args",
  "tool.order",
  "state.equals",
  "state.has",
  "state.contains",
  "policy.none",
]);

/** Never imports the current case modules: only complete sealed deterministic contracts are eligible. */
export function frozenImprovementCases(run: RunSnapshot): TestCase[] {
  if (
    !["completed", "failed"].includes(run.status) ||
    run.completedCases !== run.totalCases ||
    run.results.length !== run.totalCases ||
    !run.totalCases ||
    run.totalCases > 256 ||
    run.experiences?.length
  )
    input("Use a complete Agent baseline with at most 256 trials and no loaded experiences");
  const cases = new Map<string, { testCase: TestCase; results: RunSnapshot["results"] }>();
  for (const result of run.results) {
    const source = result.sourceCase;
    if (
      !source ||
      source.id !== result.caseId ||
      !source.assertions?.length ||
      source.assertions.some((a) => !supportedAssertions.has(a.type)) ||
      /\[REDACTED[^\]]*\]/i.test(JSON.stringify(source))
    )
      input(
        "Baseline cases require retained, non-redacted deterministic assertions; predicate, schema, Judge and unknown assertions are unsupported",
      );
    let testCase: TestCase;
    try {
      testCase = parseTestCase(source) as TestCase;
    } catch {
      input("A retained source case is incomplete or invalid");
    }
    const existing = cases.get(result.caseId);
    if (existing && hash(existing.testCase) !== hash(testCase))
      input("Repeated baseline cases have different frozen contracts");
    if (existing) existing.results.push(result);
    else cases.set(result.caseId, { testCase, results: [result] });
  }
  if (cases.size < 2 || cases.size > 64) input("Controlled verification requires 2 to 64 distinct baseline cases");
  return [...cases.values()].map(({ testCase, results }) => {
    const count = results.length;
    if (
      count > 1 &&
      (results.some((r) => r.repetitionTotal !== count) ||
        new Set(results.map((r) => r.repetition)).size !== count ||
        results.some((r) => !r.repetition || r.repetition < 1 || r.repetition > count))
    )
      input("Baseline repetitions must be complete and uniquely numbered");
    if (
      count === 1 &&
      ((results[0]!.repetitionTotal !== undefined && results[0]!.repetitionTotal !== 1) ||
        (results[0]!.repetition !== undefined && results[0]!.repetition !== 1))
    )
      input("Baseline repetitions are incomplete");
    return { ...testCase, options: { repetitions: count } };
  });
}

/** Existing ordinary project files only; a declared scope is not an execution sandbox. */
function projectFile(context: ProjectContext, path: string): string {
  if (!isRepairTaskPath(path)) input("Use canonical project-relative ordinary file paths");
  const root = realpathSync.native(context.projectRoot),
    file = resolve(root, path),
    rel = relative(root, file);
  if (!rel || rel.startsWith(`..${sep}`) || rel === "..")
    input("Candidate files must remain inside the selected project");
  let current = root;
  for (const part of path.split("/")) {
    current = resolve(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) input("Candidate paths must not traverse symbolic links");
  }
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > 1_048_576)
    input("Candidate inputs must be ordinary, unshared files of at most 1 MiB");
  return file;
}
function fingerprint(context: ProjectContext, entry: string, allowedPaths: string[]) {
  const configPath = relative(context.projectRoot, context.configFile).replaceAll("\\", "/"),
    configFileHash = sha256(readFileSync(projectFile(context, configPath))),
    entryHash = sha256(readFileSync(projectFile(context, entry))),
    allowed = allowedPaths.map((path) => ({ path, hash: sha256(readFileSync(projectFile(context, path))) }));
  return {
    configPath,
    configFileHash,
    entry,
    entryHash,
    inventoryHash: hash({ sources: projectSourceInventory(context.projectRoot), allowed }),
  };
}
function contracts(cases: TestCase[]) {
  return hash(cases.map(({ options: _options, ...sourceCase }) => sourceCase));
}
export interface ImprovementPreparation {
  runId: string;
  optionId: string;
  reportHash: string;
  expectedRevision: number;
  entry: string;
  allowedPaths: string[];
  regressionCaseIds: string[];
  holdoutCaseIds: string[];
  maxRuns: number;
  maxDurationMs: number;
  maxToolCalls: number;
  maxCases: number;
}
export function prepareControlledImprovement(
  context: ProjectContext,
  preparation: ImprovementPreparation,
): ImprovementSession {
  const repository = new FileArtifactRepository(context.artifactRoot),
    view = readQualityAssessment(repository, preparation.runId),
    { run } = readSealedQualityRun(repository, view.report.binding.runId),
    selected = view.selections.find((item) => item.optionId === preparation.optionId),
    option = view.report.options.find((item) => item.id === preparation.optionId);
  if (
    view.report.contentHash !== preparation.reportHash ||
    view.revision !== preparation.expectedRevision ||
    !selected ||
    !option
  )
    input("Prepare against the current selected option, report hash and decision revision");
  if (
    !["repair-behavior", "add-validation"].includes(option.action) ||
    !option.scope.caseIds.length ||
    option.scope.checkIds.length
  )
    input("This stage executes candidate Agent verification for selected behavior or validation options only");
  const cases = frozenImprovementCases(run),
    ids = cases.map((c) => c.id),
    failed = [...new Set(run.results.filter((r) => !r.passed).map((r) => r.caseId))];
  if (
    !failed.length ||
    failed.some((id) => !preparation.regressionCaseIds.includes(id)) ||
    option.scope.caseIds.some((id) => !preparation.regressionCaseIds.includes(id)) ||
    preparation.holdoutCaseIds.some((id) => !ids.includes(id) || run.results.some((r) => r.caseId === id && !r.passed))
  )
    input(
      "Regression scope must contain every original failure and the selected cases; holdout cases must previously pass",
    );
  const candidate = fingerprint(context, preparation.entry, preparation.allowedPaths),
    body = {
      v: 1 as const,
      kind: "canary.improvement-plan" as const,
      id: `improvement_${randomUUID()}`,
      projectId: view.report.projectId,
      createdAt: new Date().toISOString(),
      baseline: view.report.binding,
      selection: {
        reportHash: preparation.reportHash,
        expectedRevision: preparation.expectedRevision,
        optionId: option.id,
        selectionRevision: selected.revision,
      },
      scope: {
        caseIds: ids,
        regressionCaseIds: preparation.regressionCaseIds,
        holdoutCaseIds: preparation.holdoutCaseIds,
        allowedPaths: preparation.allowedPaths,
        contractsHash: contracts(cases),
        trials: run.totalCases,
      },
      candidate,
      budget: {
        maxRuns: preparation.maxRuns,
        maxCases: preparation.maxCases,
        maxDurationMs: preparation.maxDurationMs,
        maxToolCalls: preparation.maxToolCalls,
        maxLiveModelCalls: 0 as const,
      },
      success: {
        requireRegressionImprovement: true as const,
        allowRegressions: false as const,
        requireHoldoutPass: true as const,
        minimumPairs: 5 as const,
      },
      executionGranted: false as const,
    };
  return createImprovementSession(repository, parseImprovementPlan({ ...body, contentHash: hash(body) }));
}
/** Config imports run in a terminable child, so top-level await or a busy loop cannot hold this attempt open. */
async function readExecutableConfig(file: string, signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) throw new Error("Config load cancelled");
  const token = randomUUID(),
    tsx = pathToFileURL(createRequire(import.meta.url).resolve("tsx/esm/api")).href,
    script = `const file=${JSON.stringify(file)}, token=${JSON.stringify(token)}; try {const url=(await import('node:url')).pathToFileURL(file).href; const module=/\\.[cm]?tsx?$/.test(file)?await(await import(${JSON.stringify(tsx)})).tsImport(url,{parentURL:${JSON.stringify(import.meta.url)}}):await import(url); const value=module.default; const raw=value&&typeof value==='object'&&'default'in value?value.default:value; const body=JSON.stringify(raw); if(typeof body!=='string'||Buffer.byteLength(body)>1048576)throw Error('config budget'); process.send({token,body},()=>process.disconnect());}catch{process.exitCode=2;if(process.connected)process.disconnect();}`;
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      cwd: resolve(file, ".."),
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    let body: string | undefined,
      outputBytes = 0,
      failed = false;
    const abort = () => {
      failed = true;
      if (child.pid) killProcessTree(child.pid);
    };
    signal.addEventListener("abort", abort, { once: true });
    const output = (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > 262_144) abort();
    };
    child.stdout?.on("data", output);
    child.stderr?.on("data", output);
    child.on("message", (message: unknown) => {
      if (
        !message ||
        typeof message !== "object" ||
        !("token" in message) ||
        message.token !== token ||
        !("body" in message) ||
        typeof message.body !== "string" ||
        Buffer.byteLength(message.body) > 1_048_576 ||
        body !== undefined
      ) {
        abort();
        return;
      }
      body = message.body;
    });
    child.on("error", () => {
      failed = true;
    });
    child.on("close", (code) => {
      signal.removeEventListener("abort", abort);
      if (failed || signal.aborted || code !== 0 || !body) {
        reject(new Error("Trusted configuration could not load within its execution budget"));
        return;
      }
      try {
        accept(JSON.parse(body));
      } catch {
        reject(new Error("Trusted configuration did not return bounded JSON"));
      }
    });
    if (signal.aborted) abort();
  });
}
async function importConfig(file: string, signal: AbortSignal): Promise<CanaryConfig> {
  let raw: unknown;
  if (file.endsWith(".json")) raw = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  else raw = await readExecutableConfig(file, signal);
  const config = parseCanaryConfig(raw) as CanaryConfig;
  if (
    config.agent.adapter !== "function" ||
    (config.tools && config.tools.adapter !== "mock") ||
    config.judge?.provider === "http"
  )
    input(
      "Controlled verification permits function Agents, mock tools and deterministic managed model/Judge providers only",
    );
  return config;
}
function spent(attempts: ImprovementAttempt[], field: "durationMs" | "toolCalls") {
  return attempts.reduce((total, attempt) => total + (attempt.result?.observed[field] ?? 0), 0);
}
export async function executeControlledImprovement(
  context: ProjectContext,
  sessionId: string,
  authorization: ImprovementAuthorization,
  options: { signal?: AbortSignal; ports?: RunnerPorts } = {},
): Promise<ImprovementSession> {
  const repository = new FileArtifactRepository(context.artifactRoot);
  return executeImprovementSession(repository, sessionId, authorization, async (plan, _attempt, previous) => {
    const started = Date.now(),
      controller = new AbortController(),
      remainingMs = plan.budget.maxDurationMs - spent(previous, "durationMs"),
      remainingTools = plan.budget.maxToolCalls - spent(previous, "toolCalls");
    let toolCalls = 0,
      executedCases = 0,
      timeout = false,
      toolBudget = false,
      toolEvidenceInvalid = false,
      candidateRunId: string | undefined,
      candidateManifestHash: string | undefined;
    const observed = () => ({
      durationMs: Date.now() - started,
      cases: executedCases,
      toolCalls,
      managedLiveModelCalls: 0 as const,
      monetaryCost: null,
    });
    const stopped = (code: string, status: "blocked" | "cancelled" = "blocked"): ImprovementAttemptResult => ({
      status,
      code,
      candidateRunId,
      candidateManifestHash,
      observed: observed(),
    });
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(
      () => {
        timeout = true;
        controller.abort();
      },
      Math.max(1, remainingMs),
    );
    try {
      if (options.signal?.aborted) return stopped("IMPROVEMENT_CANCELLED", "cancelled");
      if (remainingMs < 1 || remainingTools < 0) return stopped("IMPROVEMENT_BUDGET");
      if (hash(fingerprint(context, plan.candidate.entry, plan.scope.allowedPaths)) !== hash(plan.candidate))
        return stopped("IMPROVEMENT_SOURCE_DRIFT");
      const { run: baseline } = readSealedQualityRun(repository, plan.baseline.runId),
        cases = frozenImprovementCases(baseline);
      if (contracts(cases) !== plan.scope.contractsHash || baseline.totalCases !== plan.scope.trials)
        return stopped("IMPROVEMENT_CONTRACT_DRIFT");
      // The durable running attempt has already been written before any trusted module import.
      const loaded = await importConfig(context.configFile, controller.signal);
      if (loaded.tools?.entry) {
        const path = loaded.tools.entry.replace(/^\.\//, "");
        if (!plan.scope.allowedPaths.includes(path))
          input("Declare the mock tool entry in the frozen allowed file paths");
        projectFile(context, path);
      }
      if (controller.signal.aborted || Date.now() - started >= remainingMs)
        return stopped("IMPROVEMENT_TIMEOUT", "cancelled");
      if (hash(fingerprint(context, plan.candidate.entry, plan.scope.allowedPaths)) !== hash(plan.candidate))
        return stopped("IMPROVEMENT_SOURCE_DRIFT");
      const config: CanaryConfig = {
        ...loaded,
        agent: { ...loaded.agent, entry: plan.candidate.entry },
        runtime: {
          ...loaded.runtime,
          concurrency: 1,
          repetitions: 1,
          timeoutMs: Math.min(loaded.runtime?.timeoutMs ?? remainingMs, remainingMs),
          maxToolCalls: Math.min(loaded.runtime?.maxToolCalls ?? remainingTools, remainingTools),
        },
        reporters: ["json", "markdown", "junit"],
      };
      const executor = options.ports?.executeCase ?? createRunnerPorts().executeCase;
      const result = await runEvaluation({
        store: new RunStore(),
        context,
        config,
        selected: cases,
        candidateOf: baseline.runId,
        signal: controller.signal,
        silent: true,
        experiences: { load: () => ({ loaded: [], skipped: [], totalChars: 0 }) },
        ports: {
          executeCase: async (runOptions, testCase) => {
            const leftMs = Math.max(1, remainingMs - (Date.now() - started)),
              leftTools = Math.max(0, remainingTools - toolCalls);
            let caseManagedCalls = 0;
            executedCases++;
            const execution = await executor(
              {
                ...runOptions,
                controlledToolBudget: Math.min(
                  leftTools,
                  config.runtime?.maxToolCalls ?? leftTools,
                  config.runtime?.maxSteps ?? leftTools,
                ),
                onEvent: (event) => {
                  if (event.type === "trace.event" && event.event.type === "canary.controlled.tool_call") {
                    toolCalls++;
                    caseManagedCalls++;
                    if (toolCalls > remainingTools) {
                      toolBudget = true;
                      controller.abort();
                    }
                  }
                  if (event.type === "trace.event" && event.event.type === "canary.controlled.tool_budget_exceeded") {
                    toolBudget = true;
                    controller.abort();
                  }
                  if (event.type === "trace.event" && event.event.type === "canary.controlled.tool_evidence_invalid") {
                    toolEvidenceInvalid = true;
                    controller.abort();
                  }
                  runOptions.onEvent?.(event);
                },
              },
              {
                ...testCase,
                options: {
                  ...testCase.options,
                  timeoutMs: Math.min(testCase.options?.timeoutMs ?? config.runtime!.timeoutMs!, leftMs),
                  maxToolCalls: Math.min(testCase.options?.maxToolCalls ?? config.runtime!.maxToolCalls!, leftTools),
                  maxSteps: config.runtime?.maxSteps,
                  maxBudget: config.runtime?.maxBudget,
                },
              },
            );
            return {
              ...execution,
              ...(execution.metrics ? { metrics: { ...execution.metrics, toolCalls: caseManagedCalls } } : {}),
            };
          },
        },
      });
      const sealed = readSealedQualityRun(repository, result.runId);
      candidateRunId = result.runId;
      candidateManifestHash = sealed.manifestHash;
      if (hash(fingerprint(context, plan.candidate.entry, plan.scope.allowedPaths)) !== hash(plan.candidate))
        return stopped("IMPROVEMENT_SOURCE_DRIFT");
      if (toolBudget) return stopped("IMPROVEMENT_TOOL_BUDGET");
      if (toolEvidenceInvalid) return stopped("IMPROVEMENT_TOOL_EVIDENCE");
      if (controller.signal.aborted || timeout || options.signal?.aborted)
        return stopped(timeout ? "IMPROVEMENT_TIMEOUT" : "IMPROVEMENT_CANCELLED", "cancelled");
      const benefit = measureControlledBenefit(baseline, sealed.run, {
          regressionCaseIds: plan.scope.regressionCaseIds,
          holdoutCaseIds: plan.scope.holdoutCaseIds,
        }),
        verified =
          result.exitCode === 0 &&
          sealed.run.status === "completed" &&
          benefit.status === "observed-improvement" &&
          benefit.changes.regressed === 0 &&
          !sealed.run.results.some((r) => plan.scope.holdoutCaseIds.includes(r.caseId) && !r.passed);
      return {
        status: "completed",
        code: verified ? "IMPROVEMENT_VERIFIED" : "IMPROVEMENT_EVALUATED",
        candidateRunId,
        candidateManifestHash,
        observed: observed(),
        benefit,
      };
    } catch (error) {
      return stopped(
        timeout
          ? "IMPROVEMENT_TIMEOUT"
          : options.signal?.aborted
            ? "IMPROVEMENT_CANCELLED"
            : error instanceof ImprovementInputError
              ? "IMPROVEMENT_CONFIG_UNSUPPORTED"
              : "IMPROVEMENT_EXECUTION_BLOCKED",
        controller.signal.aborted ? "cancelled" : "blocked",
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    }
  });
}

function numberFlag(flags: Map<string, string[]>, name: string): number {
  const value = flags.get(name)?.[0];
  if (!value || !/^(0|[1-9][0-9]*)$/.test(value)) input(`Provide ${name} as a nonnegative integer`);
  return Number(value);
}
function valueFlag(flags: Map<string, string[]>, name: string): string {
  const value = flags.get(name)?.[0];
  if (!value) input(`Provide ${name}`);
  return value;
}
export async function controlledImprovementCommand(args: string[]): Promise<number> {
  const json = args.includes("--json");
  try {
    const [command, id] = args;
    if (!["prepare", "execute", "show"].includes(command ?? "") || !id || id.startsWith("--"))
      input("Use canary improvement prepare <runId>, execute <sessionId>, or show <sessionId>");
    const flags = new Map<string, string[]>(),
      booleans = new Set<string>(),
      repeatable = new Set(["--allow", "--regression", "--holdout"]),
      allowed = new Set([
        "--project",
        "--config",
        ...(command === "prepare"
          ? [
              "--option",
              "--report-hash",
              "--expected-revision",
              "--entry",
              "--allow",
              "--regression",
              "--holdout",
              "--max-runs",
              "--max-ms",
              "--max-tool-calls",
              "--max-cases",
            ]
          : command === "execute"
            ? ["--plan-hash", "--actor", "--reason"]
            : []),
      ]);
    for (let index = 2; index < args.length; index++) {
      const name = args[index]!;
      if (name === "--json" || (name === "--execute" && command === "execute")) {
        if (booleans.has(name)) input("Duplicate command flag");
        booleans.add(name);
        continue;
      }
      const value = args[++index];
      if (!allowed.has(name) || !value || value.startsWith("--") || (flags.has(name) && !repeatable.has(name)))
        input("Unknown, duplicate or incomplete improvement option");
      flags.set(name, [...(flags.get(name) ?? []), value]);
    }
    const context = resolveProjectContext({
      cwd: flags.has("--project") ? resolve(valueFlag(flags, "--project")) : undefined,
      configPath: flags.get("--config")?.[0],
    });
    let session: ImprovementSession;
    if (command === "prepare")
      session = prepareControlledImprovement(context, {
        runId: id,
        optionId: valueFlag(flags, "--option"),
        reportHash: valueFlag(flags, "--report-hash"),
        expectedRevision: numberFlag(flags, "--expected-revision"),
        entry: valueFlag(flags, "--entry"),
        allowedPaths: flags.get("--allow") ?? [],
        regressionCaseIds: flags.get("--regression") ?? [],
        holdoutCaseIds: flags.get("--holdout") ?? [],
        maxRuns: numberFlag(flags, "--max-runs"),
        maxDurationMs: numberFlag(flags, "--max-ms"),
        maxToolCalls: numberFlag(flags, "--max-tool-calls"),
        maxCases: numberFlag(flags, "--max-cases"),
      });
    else if (command === "show") session = readImprovementSession(new FileArtifactRepository(context.artifactRoot), id);
    else {
      if (!booleans.has("--execute")) input("Execution requires --execute, the exact plan hash, actor and reason");
      const controller = new AbortController(),
        abort = () => controller.abort();
      process.once("SIGINT", abort);
      process.once("SIGTERM", abort);
      try {
        session = await executeControlledImprovement(
          context,
          id,
          {
            planHash: valueFlag(flags, "--plan-hash"),
            actor: valueFlag(flags, "--actor"),
            reason: valueFlag(flags, "--reason"),
          },
          { signal: controller.signal },
        );
      } finally {
        process.removeListener("SIGINT", abort);
        process.removeListener("SIGTERM", abort);
      }
    }
    console.log(
      json
        ? JSON.stringify(session)
        : [
            `Improvement session: ${session.plan.id}`,
            `Plan: ${session.plan.contentHash}`,
            `Frozen trials: ${session.plan.scope.trials}; attempts: ${session.attempts.length}/${session.plan.budget.maxRuns}`,
            ...session.attempts.map(
              (a) =>
                `Attempt ${a.index}: ${a.state}${a.result ? ` · ${a.result.code} · ${a.result.benefit?.status ?? "not measured"}` : ""}`,
            ),
            "Candidate verification uses trusted project code; no automatic edits or experience activation. Observed calls do not meter arbitrary outbound code.",
          ].join("\n"),
    );
    const last = session.attempts.at(-1);
    return command === "execute" &&
      (last?.result?.status !== "completed" ||
        last.result.code !== "IMPROVEMENT_VERIFIED" ||
        last.result.benefit?.status !== "observed-improvement")
      ? 1
      : 0;
  } catch (error) {
    const invalid =
        error instanceof ImprovementInputError ||
        (error instanceof ControlledImprovementError && error.code === "IMPROVEMENT_INPUT") ||
        (error instanceof Error && error.name === "ZodError"),
      code = invalid
        ? "IMPROVEMENT_INPUT"
        : error instanceof QualityAssessmentError || error instanceof ControlledImprovementError
          ? error.code
          : "IMPROVEMENT_BLOCKED",
      message =
        error instanceof ImprovementInputError ||
        error instanceof QualityAssessmentError ||
        error instanceof ControlledImprovementError
          ? error.message
          : invalid
            ? "Provide a complete plan with valid case scopes, file paths and budgets"
            : "Improvement evidence or session is unavailable; execution was not authorized or could not complete safely";
    if (json)
      console.log(JSON.stringify({ v: 1, kind: "canary.improvement-error", code, message, executionGranted: false }));
    else console.error(`${code}: ${message}`);
    return invalid ? 2 : 1;
  }
}
