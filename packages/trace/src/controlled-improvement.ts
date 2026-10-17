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
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  IMPROVEMENT_MAX_RECORD_BYTES,
  IMPROVEMENT_MAX_SESSIONS,
  improvementAttemptResultSchema,
  improvementAuthorizationSchema,
  improvementRecoveryInputSchema,
  improvementRecoveryViewSchema,
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
import { atomicWrite, sha256 } from "./artifacts.js";
import { containsSensitiveValue } from "./privacy.js";
import { FileArtifactRepository } from "./store.js";
import { withCollectionMutation } from "./collection-guard.js";
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
      (name !== "catalog.lock" &&
        !/^improvement_[a-f0-9-]{36}\.json(?:\.lock|\.recover\.lock|\.[a-f0-9-]{36}\.tmp)?$/.test(name))
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
function lock(file: string): (() => void) & { owner: { pid: number; nonce: string } } {
  let fd: number;
  try {
    fd = withCollectionMutation(dirname(dirname(file)),()=>{mkdirSync(dirname(file),{recursive:true});qualityOrdinaryParents(dirname(file));return openSync(`${file}.lock`, "wx", 0o600);});
  } catch {
    return fail("IMPROVEMENT_BUSY", "An improvement writer is active or interrupted; inspect its lock before retrying");
  }
  const owner = { pid: process.pid, nonce: randomUUID() };
  try {
    writeFileSync(fd, JSON.stringify(owner));
    fsyncSync(fd);
  } catch (error) {
    closeSync(fd);
    unlinkSync(`${file}.lock`);
    throw error;
  }
  return Object.assign(
    () => {
      closeSync(fd);
      unlinkSync(`${file}.lock`);
    },
    { owner },
  );
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
    fail(
      "IMPROVEMENT_STORAGE",
      "Improvement session limit (64) reached; preserve existing evidence and use a new artifact collection for additional runs",
    );
  const release = lock(join(state.root, "catalog"));
  try {
    if (storage(repository).files.length >= IMPROVEMENT_MAX_SESSIONS)
      fail(
        "IMPROVEMENT_STORAGE",
        "Improvement session limit (64) reached; preserve existing evidence and use a new artifact collection for additional runs",
      );
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

function ownerIsLive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Only an explicit missing process is proof of death. Permission errors remain blocked.
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}
function recoveryState(repository: FileArtifactRepository, id: string) {
  const state = storage(repository),
    file = fileFor(state.root, id),
    session = read(file, state.projectId);
  let lockHash = "absent",
    lockOwner: { pid: number; nonce: string } | undefined;
  if (existsSync(`${file}.lock`)) {
    try {
      const bytes = readQualityBytes(`${file}.lock`, 2048),
        value = JSON.parse(bytes.toString("utf8"));
      const keys = Object.keys(value);
      const nonce = value.nonce ?? value.token;
      if (
        keys.length !== 2 ||
        !keys.includes("pid") ||
        !keys.some((k) => k === "nonce" || k === "token") ||
        !Number.isSafeInteger(value.pid) ||
        value.pid < 1 ||
        value.pid > 2_147_483_647 ||
        typeof nonce !== "string" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(nonce)
      )
        throw new Error("Invalid owner");
      lockHash = sha256(bytes);
      lockOwner = { pid: value.pid, nonce };
    } catch {
      fail("IMPROVEMENT_STORAGE", "The interrupted writer lock is invalid; preserve it for inspection");
    }
  }
  const running = session.attempts.find((attempt) => attempt.state === "running");
  let status: "ready" | "active" | "not-needed" | "blocked" = "ready";
  let code = "IMPROVEMENT_RECOVERY_READY";
  if (lockOwner && running?.owner && (lockOwner.pid !== running.owner.pid || lockOwner.nonce !== running.owner.nonce)) {
    status = "blocked";
    code = "IMPROVEMENT_OWNER_MISMATCH";
  } else if ((lockOwner && ownerIsLive(lockOwner.pid)) || (running?.owner && ownerIsLive(running.owner.pid))) {
    status = "active";
    code = "IMPROVEMENT_OWNER_ACTIVE";
  } else if (running && !running.owner && !lockOwner) {
    status = "blocked";
    code = "IMPROVEMENT_OWNER_UNKNOWN";
  } else if (!running && !lockOwner) {
    status = "not-needed";
    code = "IMPROVEMENT_RECOVERY_NOT_NEEDED";
  }
  return { state, file, session, running, lockHash, status, code };
}
/** Inspect the durable ledger without importing project code or changing evidence. */
export function inspectImprovementRecovery(repository: FileArtifactRepository, id: string) {
  const value = recoveryState(repository, id);
  if (existsSync(`${value.file}.recover.lock`))
    fail("IMPROVEMENT_BUSY", "Another recovery is active or interrupted; inspect its guard");
  return improvementRecoveryViewSchema.parse({
    v: 1 as const,
    kind: "canary.improvement-recovery" as const,
    sessionId: id,
    sessionHash: value.session.contentHash,
    planHash: value.session.plan.contentHash,
    revision: value.session.revision,
    lockHash: value.lockHash,
    status: value.status,
    code: value.code,
    nextAction:
      value.status === "ready"
        ? "Review the exact session and lock hashes, then apply recovery with an actor and reason. The attempt remains consumed; no work is rerun."
        : value.status === "not-needed"
          ? "No recovery is necessary."
          : "Wait for the owner to exit or inspect the preserved ownership evidence; no process will be terminated.",
    executionGranted: false as const,
  });
}
/** Close a dead-owner ledger only after exact-state approval. Persisted PIDs never authorize signals. */
export function recoverImprovementSession(
  repository: FileArtifactRepository,
  id: string,
  input: unknown,
): ImprovementSession {
  const parsed = improvementRecoveryInputSchema.safeParse(input);
  if (!parsed.success || containsSensitiveValue(parsed.data))
    fail("IMPROVEMENT_INPUT", "Recovery requires exact session/lock hashes, actor and reason without credentials");
  const authorization = parsed.data;
  const initial = recoveryState(repository, id),
    releaseGuard = lock(`${initial.file}.recover`);
  try {
    const current = recoveryState(repository, id);
    if (current.session.contentHash !== authorization.sessionHash || current.lockHash !== authorization.lockHash)
      fail("IMPROVEMENT_STALE", "Recovery state changed; inspect it and review fresh hashes");
    if (current.status !== "ready") fail("IMPROVEMENT_BUSY", "The writer is active, unproven or already recovered");
    if ((current.session.recoveries?.length ?? 0) >= 8)
      fail("IMPROVEMENT_STORAGE", "Recovery audit limit reached; preserve this session for inspection");
    if (current.lockHash !== "absent") unlinkSync(`${current.file}.lock`);
    const release = lock(current.file);
    try {
      // All managed executors check the recovery guard after acquiring this record lock.
      const reread = read(current.file, current.state.projectId);
      if (reread.contentHash !== authorization.sessionHash)
        fail("IMPROVEMENT_STALE", "Session changed while acquiring recovery ownership");
      const at = new Date().toISOString();
      return save(current.file, {
        ...reread,
        revision: reread.revision + (current.running ? 2 : 1),
        attempts: reread.attempts.map((attempt) =>
          attempt.state !== "running"
            ? attempt
            : {
                ...attempt,
                state: "finished",
                finishedAt: at,
                result: {
                  status: "blocked",
                  code: "IMPROVEMENT_INTERRUPTED",
                  observed: {
                    durationMs: null,
                    cases: null,
                    toolCalls: null,
                    managedLiveModelCalls: 0,
                    monetaryCost: null,
                  },
                },
              },
        ),
        recoveries: [...(reread.recoveries ?? []), { ...authorization, at }],
      });
    } finally {
      release();
    }
  } finally {
    releaseGuard();
  }
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
    if (existsSync(`${file}.recover.lock`)) fail("IMPROVEMENT_BUSY", "An explicit recovery is in progress");
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
        owner: release.owner,
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
          cases: null,
          toolCalls: null,
          managedLiveModelCalls: 0,
          monetaryCost: null,
        },
      };
    }
    result.observed.durationMs = Math.max(result.observed.durationMs ?? 0, Date.now() - started);
    const duration = previous.reduce(
        (total, item) => total + (item.result?.observed.durationMs ?? 0),
        result.observed.durationMs,
      ),
      tools = previous.reduce(
        (total, item) => total + (item.result?.observed.toolCalls ?? 0),
        result.observed.toolCalls ?? 0,
      );
    if (
      duration > plan.budget.maxDurationMs ||
      tools > plan.budget.maxToolCalls ||
      (result.observed.cases ?? 0) > plan.scope.trials
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
