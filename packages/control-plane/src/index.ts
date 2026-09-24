import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ActiveExperiencePointer, AuthorizationRecord, ExperienceRecord, RunSnapshot } from "@canary/core";
import { FileArtifactRepository, redactValue } from "@canary/trace";
import { assessSoftTrial, compareRuns, isHoldoutCase, softTrialDatasetIdentity, type SoftTrialRecord } from "@canary/improvement";
import { ExperienceStore, experienceIdentityHash, validateExperienceInput } from "@canary/experience";
import { TrustedApplyer, type CandidateManifest, type ApplyJournal } from "@canary/hard-evolution";
import {
  AuthorizationStore,
  contentHash,
  isAuthorizationLive,
  PathGuard,
  DEFAULT_PROTECT,
  type BudgetSnapshot,
  type EvolutionPolicyDocument,
} from "@canary/policy";
import { LoopController, createIdlePorts, type LoopSnapshot } from "@canary/loop";
import { assert, atomic, ControlError, guarded, hash, locked, names, read, safeId } from "./storage.js";
import {
  holdoutIdentity,
  leakageAudit,
  observeAnchor,
  quality,
  type Anchor,
  type Exposure,
  type HoldoutEpoch,
} from "./observation.js";

export interface ControlState {
  v: 1;
  anchors: Anchor[];
  epochs: HoldoutEpoch[];
  exposures: Exposure[];
}
export type Action =
  | "audit.reconcile"
  | "anchor.create"
  | "holdout.rotate"
  | "holdout.exposure"
  | "soft.approve"
  | "soft.revoke"
  | "soft.rollback"
  | "experience.revoke"
  | "hard.approve"
  | "hard.revoke"
  | "hard.rollback"
  | "authorization.revoke"
  | "loop.stop"
  | "loop.takeover"
  | "loop.revoke";
export interface Command {
  action: Action;
  target: string;
  expectedRevision: string;
  requestId: string;
  actor: string;
  reason: string;
  threshold?: number;
  channel?: Exposure["channel"];
  reference?: string;
}
export interface AuditRecord {
  v: 1;
  id: string;
  commandHash: string;
  action: Action;
  target: string;
  expectedRevision: string;
  actor: string;
  reason: string;
  at: string;
  status: "pending" | "completed" | "failed";
  finishedAt?: string;
  resultRevision?: string;
  error?: string;
  resolution?: { actor: string; reason: string; at: string; requestId: string; originalHash: string };
}
// Only human-readable free text is redacted; schema keys such as authorizations
// and enumerated action names must remain usable by readers and auditors.
function publicEvidence<T>(value: T, key = ""): T {
  if (typeof value === "string")
    return (
      ["actor", "reason", "reasons", "note", "error", "stopReason"].includes(key) ? redactValue(value) : value
    ) as T;
  if (Array.isArray(value)) return value.map((v) => publicEvidence(v, key)) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, publicEvidence(v, k)])) as T;
  return value;
}
const ACTIONS: Action[] = [
  "audit.reconcile",
  "anchor.create",
  "holdout.rotate",
  "holdout.exposure",
  "soft.approve",
  "soft.revoke",
  "soft.rollback",
  "experience.revoke",
  "hard.approve",
  "hard.revoke",
  "hard.rollback",
  "authorization.revoke",
  "loop.stop",
  "loop.takeover",
  "loop.revoke",
];

export class ControlPlane {
  readonly projectRoot: string;
  readonly artifactRoot: string;
  constructor(projectRoot: string, artifactRoot = resolve(projectRoot, ".canary/artifacts")) {
    this.projectRoot = resolve(projectRoot);
    this.artifactRoot = guarded(this.projectRoot, artifactRoot);
  }
  private path(...parts: string[]): string {
    return guarded(this.projectRoot, ...parts);
  }
  private get<T>(...parts: string[]): T | undefined {
    return read<T>(this.path(...parts));
  }
  private jsonFiles<T>(dir: string): T[] {
    return names(this.projectRoot, dir)
      .map((n) => this.get<T>(dir, n))
      .filter((r): r is T => r !== undefined);
  }
  private nested<T>(dir: string, file: string): T[] {
    return names(this.projectRoot, dir, true)
      .map((n) => this.get<T>(dir, safeId(n), file))
      .filter((r): r is T => r !== undefined);
  }
  state(): ControlState {
    return (
      this.get<ControlState>(".canary/control-plane/state.json") ?? { v: 1, anchors: [], epochs: [], exposures: [] }
    );
  }
  audit(): AuditRecord[] {
    return this.jsonFiles<AuditRecord>(".canary/control-plane/audit")
      .map((a) => ({
        ...a,
        resolution: (() => {
          const resolution = this.get<AuditRecord["resolution"]>(
            ".canary/control-plane/resolutions",
            safeId(a.id) + ".json",
          );
          assert(!resolution || resolution.originalHash === hash(a), "Audit resolution evidence changed");
          return resolution;
        })(),
      }))
      .sort((a, b) => a.at.localeCompare(b.at));
  }
  runs(): RunSnapshot[] {
    const repo = new FileArtifactRepository(this.artifactRoot);
    return names(this.projectRoot, this.artifactRoot, true)
      .filter((n) => n !== "soft-trials")
      .flatMap((n) => {
        this.path(this.artifactRoot, safeId(n), "run.json");
        const r = repo.readRun(n);
        return r ? [r] : [];
      })
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  private run(id: string): RunSnapshot {
    this.path(this.artifactRoot, safeId(id), "run.json");
    const run = new FileArtifactRepository(this.artifactRoot).readRun(id);
    assert(run, "Run not found", 404);
    return run;
  }
  private pointer(): ActiveExperiencePointer | undefined {
    return this.get(".canary/experiences/active.json");
  }
  private trial(id: string): SoftTrialRecord {
    const t = this.get<SoftTrialRecord>(this.artifactRoot, "soft-trials", safeId(id), "trial.json");
    assert(t && t.projectRoot === this.projectRoot && t.id === id, "Trial not found or wrong project", 404);
    safeId(t.experienceId);
    safeId(t.baselineRunId);
    if (t.validation) safeId(t.validation.candidateRunId);
    return t;
  }
  private experience(id: string): ExperienceRecord {
    const e = this.get<ExperienceRecord>(".canary/experiences/records", `${safeId(id)}.json`);
    assert(e && e.projectRoot === this.projectRoot && e.id === id, "Experience not found or wrong project", 404);
    return e;
  }
  private candidate(id: string): CandidateManifest {
    const c = this.get<CandidateManifest>(".canary/candidates", safeId(id), "manifest.json");
    assert(c && c.projectRoot === this.projectRoot && c.id === id, "Candidate not found or wrong project", 404);
    safeId(c.authorizationId);
    return c;
  }
  private journal(id: string): ApplyJournal {
    const j = this.get<ApplyJournal>(".canary/apply", `${safeId(id)}.json`);
    assert(j && j.id === id, "Apply journal not found", 404);
    safeId(j.authorizationId);
    safeId(j.candidateId);
    return j;
  }
  private authorization(id: string): AuthorizationRecord {
    const a = this.get<AuthorizationRecord>(".canary/policy/authorizations", `${safeId(id)}.json`);
    assert(
      a && a.id === id && resolve(a.projectRoot) === this.projectRoot,
      "Authorization not found or wrong project",
      403,
    );
    return a;
  }
  private policy(): EvolutionPolicyDocument | undefined {
    return this.get(".canary/policy/policy.json");
  }
  private loop(): LoopSnapshot | undefined {
    return this.get(".canary/loop/state.json");
  }
  private hardAuthorization(id: string): AuthorizationRecord {
    const a = this.authorization(id),
      live = isAuthorizationLive(a),
      p = this.policy();
    assert(live.ok, live.ok ? "" : live.reason, 403);
    assert(a.wired && a.mode !== "soft" && a.allow.actions.includes("apply"), "Hard action is not authorized", 403);
    assert(
      p && p.projectRoot === this.projectRoot && a.policyVersion === p.version,
      "Policy version changed or unavailable",
      409,
    );
    return a;
  }
  private resource(action: Action, id: string): unknown {
    if (action === "audit.reconcile") {
      const original = this.get<AuditRecord>(".canary/control-plane/audit", safeId(id) + ".json");
      assert(original, "Audit not found", 404);
      return { original, resolution: this.get(".canary/control-plane/resolutions", id + ".json") };
    }
    if (action === "anchor.create" || action === "holdout.rotate") return { state: this.state(), run: this.run(id) };
    if (action === "holdout.exposure") return this.state();
    if (action.startsWith("soft.")) {
      const t = this.trial(id);
      return {
        trial: t,
        experience: this.experience(t.experienceId),
        pointer: this.pointer(),
        baseline: this.run(t.baselineRunId),
        candidate: t.validation ? this.run(t.validation.candidateRunId) : null,
      };
    }
    if (action === "experience.revoke") return { record: this.experience(id), pointer: this.pointer() };
    if (action === "hard.rollback") {
      const j = this.journal(id);
      return {
        journal: j,
        authorization: this.authorization(j.authorizationId),
        policy: this.policy(),
        candidate: this.candidate(j.candidateId),
      };
    }
    if (action.startsWith("hard.")) {
      const c = this.candidate(id);
      return {
        candidate: c,
        authorization: this.authorization(c.authorizationId),
        policy: this.policy(),
        approval: this.get(".canary/policy/approvals", `${id}.json`),
      };
    }
    if (action === "authorization.revoke") return this.authorization(id);
    const loop = this.loop();
    return { loop, authorization: loop?.authorizationId ? this.authorization(loop.authorizationId) : null };
  }
  revision(action: Action, id: string): string {
    assert(ACTIONS.includes(action), "Unknown action", 400);
    safeId(id);
    return hash(this.resource(action, id));
  }
  snapshot() {
    const runs = this.runs(),
      state = this.state();
    const trials = this.nested<SoftTrialRecord>(resolve(this.artifactRoot, "soft-trials"), "trial.json");
    const candidates = this.nested<CandidateManifest>(".canary/candidates", "manifest.json");
    const experiences = this.jsonFiles<ExperienceRecord>(".canary/experiences/records");
    const journals = this.jsonFiles<ApplyJournal>(".canary/apply");
    const authorizations = this.jsonFiles<AuthorizationRecord>(".canary/policy/authorizations");
    const loop = this.loop();
    const actions: Array<{ action: Action; target: string; revision: string }> = [];
    const add = (action: Action, id: string) => {
      try {
        actions.push({ action, target: id, revision: this.revision(action, id) });
      } catch {
        /* Unusable evidence is not actionable. */
      }
    };
    for (const a of this.audit()) if (a.status === "pending" && !a.resolution) add("audit.reconcile", a.id);
    for (const t of trials) {
      if (t.status === "validated") add("soft.approve", t.id);
      if (["validated", "approved"].includes(t.status)) add("soft.revoke", t.id);
      if (t.status === "activated") add("soft.rollback", t.id);
    }
    for (const c of candidates) {
      if (["verified", "queued"].includes(c.status) && !this.get(".canary/policy/approvals", `${safeId(c.id)}.json`))
        add("hard.approve", c.id);
      if (!["revoked", "discarded"].includes(c.status)) add("hard.revoke", c.id);
    }
    for (const j of journals) if (j.status === "applied") add("hard.rollback", j.id);
    for (const e of experiences)
      if (["proposed", "validated", "active"].includes(e.status)) add("experience.revoke", e.id);
    for (const a of authorizations) if (!a.revoked) add("authorization.revoke", a.id);
    if (loop) for (const action of ["loop.stop", "loop.takeover", "loop.revoke"] as const) add(action, "loop");
    for (const r of runs)
      if (r.status === "completed") {
        add("anchor.create", r.runId);
        add("holdout.rotate", r.runId);
      }
    for (const e of state.epochs) add("holdout.exposure", e.id);
    return publicEvidence({
      v: 1,
      projectRoot: this.projectRoot,
      at: new Date().toISOString(),
      actions,
      runs: runs.map((r) => ({
        runId: r.runId,
        startedAt: r.startedAt,
        status: r.status,
        baselineRunId: r.candidateOf ?? r.replayOf ?? null,
        quality: quality(r),
        measured: { completed: r.completedCases, total: r.totalCases, passed: r.passedCases },
        loadedExperiences: (r.experiences ?? []).map((e) => ({
          id: e.id,
          version: e.version,
          contentHash: e.contentHash,
          selection: e.selection ?? null,
        })),
        agentClaims: { status: "not_used_as_evidence", count: r.results.filter((x) => x.output !== undefined).length },
        admission:
          r.candidateOf && runs.some((b) => b.runId === r.candidateOf)
            ? compareRuns(
                runs.find((b) => b.runId === r.candidateOf)!,
                r,
              ).admission
            : null,
      })),
      trials: trials.map((t) => ({
        id: t.id,
        status: t.status,
        baselineRunId: t.baselineRunId,
        candidateRunId: t.validation?.candidateRunId,
        experienceId: t.experienceId,
        experienceContentHash: t.experienceContentHash,
        datasetIdentity: t.datasetIdentity,
        regressionCaseIds: t.regressionCaseIds,
        holdoutCaseIds: t.holdoutCaseIds,
        comparison: (() => {
          const report = this.get<{ verdict?: string; improvements?: string[]; regressions?: string[]; completeness?: { passed?: boolean; reasons?: string[] } }>(this.artifactRoot, "soft-trials", safeId(t.id), "comparison.json");
          return report ? { verdict: report.verdict, improvements: report.improvements ?? [], regressions: report.regressions ?? [], completeness: report.completeness ?? null } : null;
        })(),
        validation: t.validation
          ? { valid: t.validation.valid, reasons: t.validation.reasons, validatedAt: t.validation.validatedAt }
          : null,
        authorization: t.authorization,
        nextRunId: t.nextRunId,
      })),
      candidates: candidates.map((c) => ({
        id: c.id,
        status: c.status,
        baselineHash: c.baselineHash,
        contentHash: c.contentHash,
        authorizationId: c.authorizationId,
        verification: c.verification ?? null,
        agentClaims: "candidate_report_ignored",
      })),
      activeVersions: journals
        .filter((j) => j.status === "applied")
        .map((j) => ({ journalId: j.id, candidateId: j.candidateId, hash: j.approvedHash, appliedAt: j.appliedAt })),
      experiences: experiences.map((e) => ({
        id: e.id,
        key: e.key,
        version: e.version,
        status: e.status,
        summary: e.summary,
        contentHash: e.contentHash,
        source: { kind: e.source.kind, ref: e.source.ref ?? null },
        scope: e.scope,
        provenance: e.provenance ?? null,
        limitations: e.limitations ?? [],
        validation: e.validation ?? null,
        lastLoadedRunId: runs.find((r) => r.experiences?.some((item) => item.id === e.id && item.contentHash === e.contentHash))?.runId ?? null,
      })),
      activeExperience: this.pointer() ?? null,
      loop: loop
        ? {
            state: loop.state,
            round: loop.round,
            stopReason: loop.stopReason ?? null,
            authorizationId: loop.authorizationId,
            lastCandidateId: loop.lastCandidateId,
            history: loop.history,
            hostAvailable: loop.hostAvailable,
          }
        : { state: "not_initialized", round: 0, stopReason: null },
      budget: this.get<BudgetSnapshot>(".canary/policy/budget.json") ?? null,
      authorizations: authorizations.map((a) => ({
        id: a.id,
        mode: a.mode,
        activation: a.activation,
        revoked: a.revoked ?? false,
        expiresAt: a.expiresAt ?? null,
        live: isAuthorizationLive(a).ok,
        policyVersion: a.policyVersion,
        budget: a.budget,
      })),
      anchors: state.anchors.map((a) => observeAnchor(a, runs)),
      epochs: state.epochs.map((e) => ({
        ...e,
        caseHashes: undefined,
        inputHashes: undefined,
        caseCount: e.caseHashes.length,
      })),
      leakage: state.epochs.map((e) => leakageAudit(e, runs, state.exposures)),
      audit: this.audit(),
    });
  }
  execute(command: Command, principal: { role: "reader" | "operator" }): AuditRecord {
    assert(principal.role === "operator", "Read-only principal cannot write", 403);
    assert(command && typeof command === "object" && ACTIONS.includes(command.action), "Unknown action", 400);
    safeId(command.target);
    safeId(command.requestId);
    assert(
      typeof command.actor === "string" &&
        command.actor.trim().length > 0 &&
        command.actor.length <= 160 &&
        typeof command.reason === "string" &&
        command.reason.trim().length > 0 &&
        command.reason.length <= 1000,
      "Actor and reason required (max 160/1000 characters)",
      400,
    );
    assert(
      typeof command.expectedRevision === "string" && /^[a-f0-9]{64}$/.test(command.expectedRevision),
      "Expected revision required",
      400,
    );
    return locked(this.projectRoot, () => {
      const file = this.path(".canary/control-plane/audit", `${command.requestId}.json`),
        commandHash = hash(command);
      const previous = read<AuditRecord>(file);
      if (previous) {
        assert(previous.commandHash === commandHash, "Request ID reused with different content");
        assert(
          previous.status === "completed",
          "Previous operation unresolved or failed; inspect audit before reconciliation",
        );
        return previous;
      }
      assert(
        command.action === "audit.reconcile" || !this.audit().some((a) => a.status === "pending" && !a.resolution),
        "Pending operation requires operator reconciliation before more writes",
      );
      assert(
        command.expectedRevision === this.revision(command.action, command.target),
        "Resource version changed; refresh and approve again",
      );
      const audit: AuditRecord = {
        v: 1,
        id: command.requestId,
        commandHash,
        action: command.action,
        target: command.target,
        expectedRevision: command.expectedRevision,
        actor: command.actor.trim(),
        reason: command.reason.trim(),
        at: new Date().toISOString(),
        status: "pending",
      };
      atomic(file, publicEvidence(audit));
      try {
        this.perform(command);
        audit.status = "completed";
        audit.finishedAt = new Date().toISOString();
        try {
          audit.resultRevision = this.revision(command.action, command.target);
        } catch {
          audit.resultRevision = hash({ action: command.action, completed: true });
        }
        atomic(file, publicEvidence(audit));
        return audit;
      } catch (error) {
        // Keep ambiguous side effects fail-closed. Expected precondition failures are recorded too.
        audit.status = error instanceof ControlError ? "failed" : "pending";
        audit.error = error instanceof Error ? error.message : String(error);
        audit.finishedAt = new Date().toISOString();
        atomic(file, publicEvidence(audit));
        throw error;
      }
    });
  }
  assertSoftApproval(id: string): void {
    const trial = this.trial(id);
    const approval = this.get<{ baselineHash: string; candidateHash: string; experienceContentHash: string; experienceIdentityHash?: string; datasetIdentity?: string; validationHash?: string; decisionHash?: string }>(
      ".canary/control-plane/soft-approvals",
      safeId(id) + ".json",
    );
    if (!approval) {
      const experience = this.experience(trial.experienceId);
      assert(!trial.experienceIdentityHash || trial.experienceIdentityHash === experienceIdentityHash(experience), "Experience identity changed since trial preparation");
      assert(!experience.provenance, "Project trial requires control-plane approval evidence");
      return; // Legacy S-04 approvals keep their existing contract.
    }
    assert(
      ["approved", "activated"].includes(trial.status) &&
        trial.validation &&
        hash(this.run(trial.baselineRunId)) === approval.baselineHash &&
        hash(this.run(trial.validation.candidateRunId)) === approval.candidateHash &&
        this.experience(trial.experienceId).contentHash === approval.experienceContentHash &&
        validateExperienceInput(this.experience(trial.experienceId)).contentHash === approval.experienceContentHash &&
        (!approval.experienceIdentityHash || approval.experienceIdentityHash === experienceIdentityHash(this.experience(trial.experienceId))) &&
        (!approval.datasetIdentity || approval.datasetIdentity === trial.datasetIdentity) &&
        (!approval.validationHash || approval.validationHash === hash(trial.validation)) &&
        (!approval.decisionHash || approval.decisionHash === hash({ actor: trial.authorization.actor, reason: trial.authorization.reason })),
      "Control-plane approval evidence changed or revoked",
    );
  }
  private perform(c: Command): void {
    const id = c.target;
    if (c.action === "audit.reconcile") {
      const original = this.get<AuditRecord>(".canary/control-plane/audit", id + ".json");
      assert(
        original?.status === "pending" &&
          original.id !== c.requestId &&
          !this.get(".canary/control-plane/resolutions", id + ".json"),
        "Only an unresolved pending audit can be reconciled",
      );
      atomic(
        this.path(".canary/control-plane/resolutions", id + ".json"),
        publicEvidence({
          actor: c.actor,
          reason: c.reason,
          at: new Date().toISOString(),
          requestId: c.requestId,
          originalHash: hash(original),
        }),
      );
      return;
    }
    if (c.action === "anchor.create") {
      const state = this.state(),
        run = this.run(id);
      assert(quality(run).passRate !== null, "Anchor requires complete measured run");
      assert(!state.anchors.some((a) => a.runId === id), "Anchor already exists");
      const threshold = c.threshold ?? 2;
      assert(
        Number.isFinite(threshold) && threshold > 0 && threshold <= 100,
        "Threshold must be > 0 and <= 100 percentage points",
        400,
      );
      state.anchors.push({
        id: `anchor_${id}`,
        runId: id,
        fingerprint: hash(run),
        threshold,
        createdAt: new Date().toISOString(),
      });
      atomic(this.path(".canary/control-plane/state.json"), state);
      return;
    }
    if (c.action === "holdout.rotate") {
      const state = this.state(),
        run = this.run(id),
        identity = holdoutIdentity(run),
        now = new Date().toISOString();
      assert(
        quality(run).passRate !== null &&
          identity.caseHashes.length > 0 &&
          run.results.filter(isHoldoutCase).every((r) => (r.sourceCase?.input ?? r.input) !== undefined),
        "Rotation needs a completed run with explicit holdout cases",
      );
      assert(
        !state.epochs.some(
          (e) =>
            e.datasetHash === identity.datasetHash ||
            e.caseHashes.some((h) => identity.caseHashes.includes(h)) ||
            e.inputHashes.some((h) => identity.inputHashes.includes(h)),
        ),
        "Holdout reuse/overlap refused; choose a fresh independent set",
      );
      for (const epoch of state.epochs) if (!epoch.retiredAt) epoch.retiredAt = now;
      state.epochs.push({ id: `epoch_${c.requestId}`, runId: id, ...identity, createdAt: now });
      atomic(this.path(".canary/control-plane/state.json"), state);
      return;
    }
    if (c.action === "holdout.exposure") {
      const state = this.state();
      assert(
        state.epochs.some((e) => e.id === id),
        "Epoch not found",
        404,
      );
      assert(
        c.channel &&
          ["training", "proposal", "operator"].includes(c.channel) &&
          typeof c.reference === "string" &&
          c.reference.length > 0 &&
          c.reference.length <= 1000,
        "Exposure channel and reference required",
        400,
      );
      state.exposures.push({
        epochId: id,
        channel: c.channel,
        refHash: hash(c.reference),
        at: new Date().toISOString(),
      });
      atomic(this.path(".canary/control-plane/state.json"), state);
      return;
    }
    if (c.action.startsWith("soft.")) {
      const trial = this.trial(id),
        experience = this.experience(trial.experienceId);
      assert(experience.contentHash === trial.experienceContentHash, "Experience version no longer matches trial");
      assert(!trial.experienceIdentityHash || trial.experienceIdentityHash === experienceIdentityHash(experience), "Experience identity or scope changed since trial preparation");
      if (c.action === "soft.approve") {
        assert(
          trial.status === "validated" && trial.validation?.valid,
          "Only independently validated trial can be approved",
        );
        const baseline = this.run(trial.baselineRunId),
          candidateRun = this.run(trial.validation.candidateRunId);
        if (trial.experienceIdentityHash) assert(trial.datasetIdentity === softTrialDatasetIdentity(baseline.results.filter((result) => [...trial.regressionCaseIds, ...trial.holdoutCaseIds].includes(result.caseId))), "Trial dataset identity changed");
        const comparison = compareRuns(baseline, candidateRun);
        const checked = assessSoftTrial({
          baseline,
          candidate: candidateRun,
          comparison,
          regressionCaseIds: trial.regressionCaseIds,
          holdoutCaseIds: trial.holdoutCaseIds,
          candidateExitCode: 0,
          comparisonArtifact: trial.validation.comparisonArtifact,
        });
        assert(
          checked.valid && quality(candidateRun).passRate !== null,
          "Independent regression/holdout validation no longer passes",
        );
        assert(
          comparison.comparable &&
            comparison.verdict === "improve" &&
            !["reject", "incomparable"].includes(comparison.admission.verdict),
          "Independent comparison no longer passes",
        );
        const checkedExperience = validateExperienceInput(experience);
        if (experience.provenance) {
          const source = experience.provenance;
          const repository = new FileArtifactRepository(this.artifactRoot);
          const sourceIntegrity = repository.verify(source.runId);
          const sourceRun = sourceIntegrity.status === "verified" && sourceIntegrity.manifestHash === source.manifestHash ? this.run(source.runId) : undefined;
          const check = sourceRun?.checks?.find((item) => item.id === source.checkId);
          assert(check?.type === "agent" && check.childRun?.runId === trial.baselineRunId, "Project candidate source is no longer verified");
          const loaded = candidateRun.experiences?.find((item) => item.id === experience.id && item.version === experience.version && item.contentHash === experience.contentHash);
          assert(loaded && trial.regressionCaseIds.every((caseId) => loaded.selection?.caseIds?.includes(caseId)) && trial.holdoutCaseIds.every((caseId) => !loaded.selection?.caseIds?.includes(caseId)), "Project candidate was not independently loaded only for regression cases");
        }
        assert(
          checkedExperience.valid &&
            checkedExperience.contentHash === experience.contentHash &&
            (["validated", "active"].includes(experience.status) || (Boolean(experience.provenance) && experience.status === "proposed")),
          "Experience is not eligible or content changed",
        );
        atomic(this.path(".canary/control-plane/soft-approvals", id + ".json"), {
          baselineHash: hash(this.run(trial.baselineRunId)),
          candidateHash: hash(this.run(trial.validation.candidateRunId)),
          experienceContentHash: trial.experienceContentHash,
          experienceIdentityHash: experienceIdentityHash(experience),
          datasetIdentity: trial.datasetIdentity,
          validationHash: hash(trial.validation),
          decisionHash: hash({ actor: c.actor, reason: c.reason }),
        });
        if (experience.provenance && experience.status === "proposed") new ExperienceStore(this.path(".canary/experiences")).transition(experience.id, "validated");
        trial.status = "approved";
        trial.authorization = {
          status: "approved",
          actor: c.actor,
          reason: c.reason,
          approvedAt: new Date().toISOString(),
        };
      } else if (c.action === "soft.revoke") {
        assert(["validated", "approved"].includes(trial.status), "Only pending/approved trial can be revoked");
        trial.status = "rejected";
        trial.authorization = { status: "not_approved", actor: c.actor, reason: c.reason };
      } else {
        assert(trial.status === "activated", "Trial is not active");
        const pointer = this.pointer();
        assert(
          pointer?.entries.some((e) => e.id === experience.id && e.contentHash === experience.contentHash),
          "Active experience changed; rollback would overwrite another activation",
        );
        const expected = [
          ...(trial.priorActive?.entries ?? []).filter((e) => e.key !== experience.key),
          { id: experience.id, key: experience.key, version: experience.version, contentHash: experience.contentHash },
        ].sort((a, b) => a.id.localeCompare(b.id));
        assert(
          hash([...pointer!.entries].sort((a, b) => a.id.localeCompare(b.id))) === hash(expected),
          "Other activation changed; refusing broad rollback",
        );
        for (const entry of trial.priorActive?.entries ?? []) {
          const prior = this.experience(entry.id);
          assert(
            prior.contentHash === entry.contentHash &&
              prior.status !== "revoked" &&
              validateExperienceInput(prior).valid,
            "Prior experience cannot be restored",
          );
        }
        const store = new ExperienceStore(this.path(".canary/experiences"));
        if (experience.status === "active") store.transition(experience.id, "validated", c.reason);
        store.restorePointer(
          trial.priorActive ?? {
            v: 1,
            projectRoot: this.projectRoot,
            entries: [],
            updatedAt: new Date().toISOString(),
          },
        );
        trial.status = "rolled_back";
      }
      atomic(this.path(this.artifactRoot, "soft-trials", id, "trial.json"), trial);
      return;
    }
    if (c.action === "experience.revoke") {
      this.experience(id);
      new ExperienceStore(this.path(".canary/experiences")).revoke(id, c.reason);
      return;
    }
    if (c.action === "authorization.revoke") {
      this.authorization(id);
      new AuthorizationStore(this.projectRoot).revoke(id, c.requestId);
      return;
    }
    if (c.action.startsWith("hard.")) {
      // Guard every directory used by H-03, including its constructor-created stores.
      for (const path of [".canary/apply", ".canary/policy/approvals", ".canary/candidates"]) this.path(path);
      if (c.action === "hard.rollback") {
        const journal = this.journal(id),
          auth = this.hardAuthorization(journal.authorizationId),
          policy = this.policy()!;
        assert(journal.status === "applied", "Journal is not active");
        const guard = new PathGuard({
          workspace: this.projectRoot,
          protect: [...DEFAULT_PROTECT, ...policy.protect, ...auth.protect.paths],
          allow: auth.allow.paths,
        });
        for (const file of journal.files) {
          const target = this.path(file.path);
          guard.assertAllowed(target, "write");
          assert(
            auth.allow.paths.some((p) => file.path === p || file.path.startsWith(p.replace(/\/$/, "") + "/")),
            "Rollback path outside authorization",
            403,
          );
          assert(
            existsSync(target) && readFileSync(target, "utf8") === file.next,
            "Source changed after application; rollback refused",
          );
        }
        new TrustedApplyer(this.projectRoot).rollback(id);
        return;
      }
      const candidate = this.candidate(id);
      if (c.action === "hard.revoke") {
        assert(candidate.status !== "revoked", "Candidate already revoked");
        new TrustedApplyer(this.projectRoot).revoke(id);
        return;
      }
      const auth = this.hardAuthorization(candidate.authorizationId);
      assert(
        candidate.policyVersion === auth.policyVersion &&
          candidate.verification?.valid &&
          candidate.verification.independent &&
          candidate.verification.candidateReportIgnored,
        "Independent verification/policy mismatch",
      );
      const policy = this.policy()!;
      const guard = new PathGuard({
        workspace: this.projectRoot,
        protect: [...DEFAULT_PROTECT, ...policy.protect, ...auth.protect.paths],
        allow: auth.allow.paths,
      });
      assert(
        candidate.contentHash === contentHash(candidate.files.map((f) => f.path + f.afterHash).join("|")),
        "Candidate manifest hash changed",
      );
      assert(resolve(candidate.workspace) === this.path(".canary/candidates", id), "Candidate workspace changed");
      for (const file of candidate.files) {
        const target = this.path(file.path);
        guard.assertAllowed(target, "write");
        const staged = this.path(".canary/candidates", id, "tree", file.path);
        assert(
          existsSync(staged) && contentHash(readFileSync(staged)) === file.afterHash,
          "Candidate source changed after verification",
        );
        assert(
          (existsSync(target) ? contentHash(readFileSync(target)) : undefined) === file.beforeHash,
          "Baseline source changed after verification",
        );
      }
      this.path(".canary/policy/approvals", `${id}.json`);
      assert(
        !this.get(".canary/policy/approvals", `${id}.json`),
        "Candidate already approved; duplicate approval refused",
      );
      new TrustedApplyer(this.projectRoot).approve({
        candidateId: id,
        actor: c.actor,
        reason: c.reason,
        authorization: auth,
      });
      return;
    }
    const loop = this.loop();
    assert(loop && id === "loop", "Loop is not initialized", 404);
    if (loop.authorizationId) safeId(loop.authorizationId);
    this.path(".canary/loop/lease.json");
    this.path(".canary/policy/budget.json");
    if (c.action === "loop.revoke" && loop.authorizationId)
      new AuthorizationStore(this.projectRoot).revoke(loop.authorizationId, c.requestId);
    atomic(this.path(".canary/loop/control.json"), {
      state: c.action === "loop.takeover" ? "human_takeover" : "stopped",
      reason: c.reason,
      at: new Date().toISOString(),
      requestId: c.requestId,
    });
    const controller = new LoopController(this.projectRoot, createIdlePorts());
    if (c.action === "loop.takeover") controller.takeover(c.reason);
    else controller.stop(c.action === "loop.revoke" ? "authorization revoked; " + c.reason : c.reason);
  }
}
export { ControlError, hash } from "./storage.js";
export { quality, observeAnchor, leakageAudit } from "./observation.js";
