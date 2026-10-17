import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  IMPROVEMENT_MAX_RECORD_BYTES,
  IMPROVEMENT_MAX_SESSIONS,
  improvementAttemptResultSchema,
  improvementAuthorizationSchema,
  parseImprovementPlan,
  parseImprovementSession,
  projectMemoryProjectId,
  qualityContentHash,
  type ImprovementAttempt,
  type ImprovementAttemptResult,
  type ImprovementAuthorization,
  type ImprovementPlan,
  type ImprovementSession,
} from "@canary/core";
import { atomicWrite } from "./artifacts.js";
import { containsSensitiveValue } from "./privacy.js";
import { FileArtifactRepository } from "./store.js";
import {
  qualityOrdinaryParents,
  readQualityAssessment,
  readQualityBytes,
  readSealedQualityRun,
} from "./quality-assessment.js";

export class ControlledImprovementError extends Error {
  constructor(
    readonly code:
      | "IMPROVEMENT_INPUT"
      | "IMPROVEMENT_STALE"
      | "IMPROVEMENT_STORAGE"
      | "IMPROVEMENT_BUSY"
      | "IMPROVEMENT_BUDGET"
      | "IMPROVEMENT_EXECUTION"
      | "IMPROVEMENT_EVIDENCE",
    message: string,
  ) {
    super(message);
    this.name = "ControlledImprovementError";
  }
}
function fail(code: ControlledImprovementError["code"], message: string): never {
  throw new ControlledImprovementError(code, message);
}
function storage(repository: FileArtifactRepository) {
  const stat = lstatSync(repository.rootDir, { throwIfNoEntry: false });
  if (!stat?.isDirectory() || stat.isSymbolicLink())
    fail("IMPROVEMENT_STORAGE", "An ordinary artifact collection is required");
  const canonical = realpathSync.native(resolve(repository.rootDir)),
    root = join(canonical, ".improvements");
  qualityOrdinaryParents(root);
  const projectId = projectMemoryProjectId(canonical);
  let bytes = 0;
  const files: string[] = [];
  const names = existsSync(root) ? readdirSync(root) : [];
  if (names.length > 196) fail("IMPROVEMENT_STORAGE", "Improvement storage entry budget exceeded");
  for (const name of names) {
    const item = lstatSync(join(root, name));
    if (
      !item.isFile() ||
      item.isSymbolicLink() ||
      item.nlink !== 1 ||
      (name !== "catalog.lock" && !/^improvement_[a-f0-9-]{36}\.json(?:\.lock|\.[a-f0-9-]{36}\.tmp)?$/.test(name))
    )
      fail("IMPROVEMENT_STORAGE", "Improvement storage contains an unsupported entry");
    bytes += item.size;
    if (item.size > IMPROVEMENT_MAX_RECORD_BYTES || bytes > 16_777_216)
      fail("IMPROVEMENT_STORAGE", "Improvement storage byte budget exceeded");
    if (name.endsWith(".json")) files.push(name);
  }
  if (files.length > IMPROVEMENT_MAX_SESSIONS) fail("IMPROVEMENT_STORAGE", "Improvement session limit exceeded");
  return { root, files, bytes, projectId };
}
function fileFor(root: string, id: string) {
  if (!/^improvement_[a-f0-9-]{36}$/.test(id)) fail("IMPROVEMENT_INPUT", "Invalid improvement identity");
  return join(root, `${id}.json`);
}
function read(file: string, projectId: string): ImprovementSession {
  try {
    const session = parseImprovementSession(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(readQualityBytes(file, IMPROVEMENT_MAX_RECORD_BYTES)),
      ),
    );
    if (session.plan.projectId !== projectId || containsSensitiveValue(session))
      fail("IMPROVEMENT_STORAGE", "Improvement project identity or privacy verification failed");
    return session;
  } catch (error) {
    if (error instanceof ControlledImprovementError) throw error;
    return fail(
      "IMPROVEMENT_STORAGE",
      "Improvement record is corrupt, missing or incomplete; restore it before continuing",
    );
  }
}
function save(file: string, session: ImprovementSession): ImprovementSession {
  const value = { ...session, contentHash: qualityContentHash(session) };
  const parsed = parseImprovementSession(value),
    body = JSON.stringify(parsed);
  if (Buffer.byteLength(body) > IMPROVEMENT_MAX_RECORD_BYTES || containsSensitiveValue(parsed))
    fail("IMPROVEMENT_STORAGE", "Improvement record exceeds its privacy or byte budget");
  atomicWrite(file, body);
  return parsed;
}
function assertSelection(repository: FileArtifactRepository, plan: ImprovementPlan) {
  const current = readQualityAssessment(repository, plan.baseline.runId);
  if (
    current.report.projectId !== plan.projectId ||
    qualityContentHash(current.report.binding) !== qualityContentHash(plan.baseline) ||
    current.report.contentHash !== plan.selection.reportHash ||
    current.revision !== plan.selection.expectedRevision ||
    !current.selections.some(
      (selection) =>
        selection.optionId === plan.selection.optionId && selection.revision === plan.selection.selectionRevision,
    )
  )
    fail("IMPROVEMENT_STALE", "Baseline or selected direction changed; prepare a new reviewed plan");
  const option = current.report.options.find((item) => item.id === plan.selection.optionId);
  if (!option || !["repair-behavior", "restore-prerequisite", "add-validation"].includes(option.action))
    fail("IMPROVEMENT_INPUT", "Select an actionable improvement before preparing candidate verification");
}
function lock(file: string): () => void {
  let fd: number;
  try {
    fd = openSync(`${file}.lock`, "wx", 0o600);
  } catch {
    return fail("IMPROVEMENT_BUSY", "An improvement writer is active or interrupted; inspect its lock before retrying");
  }
  try {
    writeFileSync(fd, JSON.stringify({ pid: process.pid, token: randomUUID() }));
    fsyncSync(fd);
  } catch (error) {
    closeSync(fd);
    unlinkSync(`${file}.lock`);
    throw error;
  }
  return () => {
    closeSync(fd);
    unlinkSync(`${file}.lock`);
  };
}
export function createImprovementSession(repository: FileArtifactRepository, value: unknown): ImprovementSession {
  let plan: ImprovementPlan;
  try {
    plan = parseImprovementPlan(value);
  } catch {
    return fail(
      "IMPROVEMENT_INPUT",
      "A complete, hashed improvement plan with explicit case scopes and budgets is required",
    );
  }
  if (containsSensitiveValue(plan)) fail("IMPROVEMENT_INPUT", "Improvement plans cannot retain credentials");
  const state = storage(repository),
    file = fileFor(state.root, plan.id);
  if (plan.projectId !== state.projectId)
    fail("IMPROVEMENT_INPUT", "Improvement plan belongs to another artifact collection");
  assertSelection(repository, plan);
  if (state.files.length >= IMPROVEMENT_MAX_SESSIONS)
    fail("IMPROVEMENT_STORAGE", "Archive improvement sessions before preparing another plan");
  mkdirSync(state.root, { recursive: true });
  qualityOrdinaryParents(state.root);
  const release = lock(join(state.root, "catalog"));
  try {
    if (storage(repository).files.length >= IMPROVEMENT_MAX_SESSIONS)
      fail("IMPROVEMENT_STORAGE", "Archive improvement sessions before preparing another plan");
    if (existsSync(file)) fail("IMPROVEMENT_STORAGE", "Improvement identity already exists");
    assertSelection(repository, plan);
    return save(file, { v: 1, kind: "canary.improvement-session", plan, revision: 0, attempts: [], contentHash: "" });
  } finally {
    release();
  }
}
export function readImprovementSession(repository: FileArtifactRepository, id: string): ImprovementSession {
  const state = storage(repository);
  return read(fileFor(state.root, id), state.projectId);
}
export function listImprovementSessions(repository: FileArtifactRepository, runId: string): ImprovementSession[] {
  // Source integrity is mandatory even when an empty history is returned.
  readSealedQualityRun(repository, runId);
  const state = storage(repository);
  return state.files
    .map((name) => read(join(state.root, name), state.projectId))
    .filter((session) => session.plan.baseline.runId === runId)
    .sort((a, b) => b.plan.createdAt.localeCompare(a.plan.createdAt) || b.plan.id.localeCompare(a.plan.id))
    .slice(0, 8);
}
export function readImprovementHistory(repository: FileArtifactRepository, runId: string) {
  const baseline = readSealedQualityRun(repository, runId),
    state = storage(repository);
  const all = state.files
    .map((name) => read(join(state.root, name), state.projectId))
    .filter((session) => session.plan.baseline.runId === runId)
    .sort((a, b) => b.plan.createdAt.localeCompare(a.plan.createdAt) || b.plan.id.localeCompare(a.plan.id));
  const sessions = all.slice(0, 8);
  const evidence = sessions.map((session) => {
    let verified =
      session.plan.baseline.manifestHash === baseline.manifestHash &&
      session.plan.baseline.runHash === baseline.runHash;
    for (const attempt of session.attempts)
      if (attempt.result?.candidateRunId) {
        try {
          const candidate = readSealedQualityRun(repository, attempt.result.candidateRunId);
          verified &&=
            candidate.manifestHash === attempt.result.candidateManifestHash &&
            candidate.run.evidence?.lineage.parentManifestHash === baseline.manifestHash &&
            candidate.run.evidence?.lineage.candidateOf === runId;
        } catch {
          verified = false;
        }
      }
    return { sessionId: session.plan.id, status: verified ? ("verified" as const) : ("unavailable" as const) };
  });
  const result = {
    v: 1 as const,
    kind: "canary.improvement-history" as const,
    runId,
    untrustedEvidence: true as const,
    sessions,
    evidence,
    omittedSessions: all.length - sessions.length,
    executionGranted: false as const,
  };
  while (Buffer.byteLength(JSON.stringify(result)) > 65_536 && result.sessions.length > 1) {
    result.sessions.pop();
    result.evidence.pop();
    result.omittedSessions++;
  }
  if (Buffer.byteLength(JSON.stringify(result)) > 65_536)
    fail(
      "IMPROVEMENT_STORAGE",
      "The newest improvement session exceeds the response budget; inspect it through the CLI",
    );
  return result;
}
/** The durable running claim consumes an attempt before any executable project code is loaded. */
export async function executeImprovementSession(
  repository: FileArtifactRepository,
  id: string,
  value: unknown,
  executor: (
    plan: ImprovementPlan,
    attempt: ImprovementAttempt,
    previousAttempts: ImprovementAttempt[],
  ) => Promise<ImprovementAttemptResult>,
): Promise<ImprovementSession> {
  const parsed = improvementAuthorizationSchema.safeParse(value);
  if (!parsed.success || containsSensitiveValue(parsed.data))
    fail("IMPROVEMENT_INPUT", "Explicit plan hash, actor and reason without credentials are required");
  const authorization: ImprovementAuthorization = parsed.data,
    state = storage(repository),
    file = fileFor(state.root, id),
    release = lock(file);
  try {
    const current = read(file, state.projectId),
      plan = current.plan;
    if (plan.contentHash !== authorization.planHash)
      fail("IMPROVEMENT_STALE", "The authorized plan hash differs from the stored plan");
    assertSelection(repository, plan);
    const previous = current.attempts;
    if (previous.some((attempt) => attempt.state === "running"))
      fail(
        "IMPROVEMENT_BUSY",
        "An interrupted attempt is already charged; inspect it instead of replaying authorization",
      );
    if (
      previous.some((attempt) => attempt.result?.status !== "completed") ||
      previous.length >= plan.budget.maxRuns ||
      (previous.length + 1) * plan.scope.trials > plan.budget.maxCases ||
      previous.reduce((total, attempt) => total + (attempt.result?.observed.durationMs ?? 0), 0) >=
        plan.budget.maxDurationMs ||
      previous.reduce((total, attempt) => total + (attempt.result?.observed.toolCalls ?? 0), 0) >
        plan.budget.maxToolCalls
    )
      fail(
        "IMPROVEMENT_BUDGET",
        "A stopped attempt or the declared cumulative budget prevents further execution; prepare a new reviewed plan",
      );
    const started = Date.now(),
      attempt: ImprovementAttempt = {
        index: previous.length + 1,
        executionRequest: authorization,
        startedAt: new Date(started).toISOString(),
        state: "running",
      };
    let saved = save(file, { ...current, revision: current.revision + 1, attempts: [...previous, attempt] });
    let result: ImprovementAttemptResult;
    let observedResult: ImprovementAttemptResult | undefined;
    try {
      result = improvementAttemptResultSchema.parse(await executor(plan, attempt, previous));
      if (containsSensitiveValue(result))
        fail("IMPROVEMENT_STORAGE", "Candidate summary exceeded its privacy boundary");
      observedResult = result;
      assertSelection(repository, plan);
      if (result.candidateRunId) {
        const candidate = readSealedQualityRun(repository, result.candidateRunId);
        if (
          candidate.manifestHash !== result.candidateManifestHash ||
          candidate.run.evidence?.lineage.candidateOf !== plan.baseline.runId ||
          candidate.run.evidence.lineage.parentManifestHash !== plan.baseline.manifestHash
        )
          fail("IMPROVEMENT_EVIDENCE", "Candidate evidence does not match the fixed baseline lineage");
      }
    } catch (error) {
      result = {
        status: "blocked",
        code: error instanceof ControlledImprovementError ? error.code : "IMPROVEMENT_EXECUTION",
        ...(observedResult?.candidateRunId
          ? {
              candidateRunId: observedResult.candidateRunId,
              candidateManifestHash: observedResult.candidateManifestHash,
            }
          : {}),
        observed: observedResult?.observed ?? {
          durationMs: Date.now() - started,
          cases: 0,
          toolCalls: 0,
          managedLiveModelCalls: 0,
          monetaryCost: null,
        },
      };
    }
    result.observed.durationMs = Math.max(result.observed.durationMs, Date.now() - started);
    const duration = previous.reduce(
        (total, item) => total + (item.result?.observed.durationMs ?? 0),
        result.observed.durationMs,
      ),
      tools = previous.reduce(
        (total, item) => total + (item.result?.observed.toolCalls ?? 0),
        result.observed.toolCalls,
      );
    if (
      duration > plan.budget.maxDurationMs ||
      tools > plan.budget.maxToolCalls ||
      result.observed.cases > plan.scope.trials
    )
      result = { ...result, status: "blocked", code: "IMPROVEMENT_BUDGET" };
    const finished: ImprovementAttempt = {
      ...attempt,
      state: "finished",
      finishedAt: new Date().toISOString(),
      result,
    };
    saved = save(file, { ...saved, revision: saved.revision + 1, attempts: [...previous, finished] });
    return saved;
  } finally {
    release();
  }
}
