import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AuthorizationRecord, EvolutionActivation, EvolutionMode } from "@canary/core";
import { ApprovalStore, PolicyDenied, PolicyStore, contentHash, isAuthorizationLive } from "@canary/policy";
import { probeIsolation } from "@canary/isolation";
import { CandidateWorkspace, projectBaselineHash, type CandidateManifest } from "./workspace.js";

export interface ApplyJournal {
  v: 1;
  id: string;
  candidateId: string;
  approvedHash: string;
  authorizationId: string;
  policyVersion: string;
  baselineHash: string;
  status: "pending" | "applying" | "applied" | "rolled_back" | "blocked";
  files: Array<{ path: string; previous?: string; next: string }>;
  appliedAt?: string;
  idempotencyKey: string;
  mode: EvolutionMode;
  activation: EvolutionActivation;
  pushAttempted?: boolean;
}

export interface ApplySwitches {
  mode: EvolutionMode;
  activation: EvolutionActivation;
  allowGitPush?: boolean;
}

const DEFAULT_SWITCHES: ApplySwitches = { mode: "soft", activation: "manual", allowGitPush: false };

export class TrustedApplyer {
  readonly projectRoot: string;
  readonly journals: string;
  readonly approvals: ApprovalStore;
  readonly policies: PolicyStore;
  readonly candidates: CandidateWorkspace;
  switches: ApplySwitches;

  constructor(projectRoot: string, switches: Partial<ApplySwitches> = {}) {
    this.projectRoot = resolve(projectRoot);
    this.journals = resolve(this.projectRoot, ".canary", "apply");
    mkdirSync(this.journals, { recursive: true });
    this.approvals = new ApprovalStore(this.projectRoot);
    this.policies = new PolicyStore(this.projectRoot);
    this.candidates = new CandidateWorkspace(this.projectRoot);
    this.switches = { ...DEFAULT_SWITCHES, ...switches };
  }

  journalPath(id: string): string { return resolve(this.journals, `${id}.json`); }

  readJournal(id: string): ApplyJournal | undefined {
    try { return JSON.parse(readFileSync(this.journalPath(id), "utf8")) as ApplyJournal; } catch { return undefined; }
  }

  private writeJournal(journal: ApplyJournal): ApplyJournal {
    const tmp = `${this.journalPath(journal.id)}.tmp`;
    writeFileSync(tmp, JSON.stringify(journal, null, 2), "utf8");
    writeFileSync(this.journalPath(journal.id), readFileSync(tmp, "utf8"), "utf8");
    try { unlinkSync(tmp); } catch { /* ignore */ }
    return journal;
  }

  approve(input: { candidateId: string; actor: string; reason: string; authorization: AuthorizationRecord }): CandidateManifest {
    if (!input.actor.trim() || !input.reason.trim()) throw new PolicyDenied("POL-06", "human actor and reason are required");
    const manifest = this.candidates.read(input.candidateId);
    if (manifest.status !== "verified" && manifest.status !== "queued") {
      throw new PolicyDenied("POL-06", `candidate is not verified: ${manifest.status}`);
    }
    this.approvals.save(input.candidateId, {
      id: input.candidateId,
      actor: input.actor,
      reason: input.reason,
      approvedHash: manifest.contentHash,
      at: new Date().toISOString(),
      authorizationId: input.authorization.id,
    });
    return manifest;
  }

  apply(input: {
    candidateId: string;
    authorization: AuthorizationRecord;
    switches?: Partial<ApplySwitches>;
    idempotencyKey?: string;
  }): ApplyJournal {
    const switches = { ...this.switches, ...input.switches };
    if (switches.mode === "soft") throw new PolicyDenied("POL-05", "soft mode cannot write project source");
    if (switches.activation === "auto_within_policy") {
      const cap = probeIsolation();
      const policy = this.policies.loadOrCreate(this.projectRoot);
      if (policy.isolation.osRequiredForAutoHard && !cap.os) {
        throw new PolicyDenied("POL-03", "OS isolation is unavailable; auto hard write is refused (fail closed)");
      }
      if (input.authorization.activation !== "auto_within_policy") {
        throw new PolicyDenied("POL-06", "authorization is not auto_within_policy");
      }
    }
    const live = isAuthorizationLive(input.authorization);
    if (!live.ok) throw new PolicyDenied("POL-06", live.reason);
    if (input.authorization.revoked) throw new PolicyDenied("POL-10", "revoked authorization blocks queued applies");
    if (!input.authorization.allow.actions.includes("apply")) throw new PolicyDenied("POL-06", "apply action is not authorized");

    const manifest = this.candidates.read(input.candidateId);
    if (manifest.status === "revoked") throw new PolicyDenied("POL-10", "revoked candidate cannot be applied");
    const idempotencyKey = input.idempotencyKey ?? `apply:${manifest.id}:${manifest.contentHash}`;
    const existing = this.findByIdempotency(idempotencyKey);
    if (existing?.status === "applied") return existing;
    if (manifest.status !== "verified" && manifest.status !== "queued") {
      throw new PolicyDenied("POL-06", `candidate cannot be applied from status ${manifest.status}`);
    }
    const approval = this.approvals.get(input.candidateId);
    if (switches.activation === "manual" && !approval) throw new PolicyDenied("POL-06", "manual hard apply requires a control-plane approval");
    if (approval && approval.approvedHash !== manifest.contentHash) {
      throw new PolicyDenied("POL-08", "approved hash does not match the candidate");
    }
    const policy = this.policies.loadOrCreate(this.projectRoot);
    if (manifest.policyVersion !== policy.version) throw new PolicyDenied("POL-08", "policy version changed after verification");
    const currentBaseline = projectBaselineHash(this.projectRoot);
    if (currentBaseline !== manifest.baselineHash) throw new PolicyDenied("POL-08", "baseline drifted after verification");

    for (const file of manifest.files) {
      const treeFile = resolve(manifest.workspace, "tree", file.path);
      if (!existsSync(treeFile) || contentHash(readFileSync(treeFile)) !== file.afterHash) {
        throw new PolicyDenied("POL-08", `candidate package changed after verification: ${file.path}`);
      }
      const target = resolve(this.projectRoot, file.path);
      const current = existsSync(target) ? contentHash(readFileSync(target)) : undefined;
      if (current !== file.beforeHash) throw new PolicyDenied("POL-08", `uncommitted or conflicting change in ${file.path}`);
    }

    const journal: ApplyJournal = {
      v: 1,
      id: `journal_${manifest.id}`,
      candidateId: manifest.id,
      approvedHash: manifest.contentHash,
      authorizationId: input.authorization.id,
      policyVersion: policy.version,
      baselineHash: manifest.baselineHash,
      status: "applying",
      files: manifest.files.map((file) => ({
        path: file.path,
        previous: existsSync(resolve(this.projectRoot, file.path)) ? readFileSync(resolve(this.projectRoot, file.path), "utf8") : undefined,
        next: readFileSync(resolve(manifest.workspace, "tree", file.path), "utf8"),
      })),
      idempotencyKey,
      mode: switches.mode,
      activation: switches.activation,
    };
    this.writeJournal(journal);
    for (const file of journal.files) {
      const target = resolve(this.projectRoot, file.path);
      mkdirSync(dirname(target), { recursive: true });
      const tmp = `${target}.canary-apply-tmp`;
      writeFileSync(tmp, file.next, "utf8");
      renameSync(tmp, target);
    }
    journal.status = "applied";
    journal.appliedAt = new Date().toISOString();
    this.writeJournal(journal);
    manifest.status = "applied";
    this.candidates.save(manifest);
    return journal;
  }

  recover(journalId: string): ApplyJournal {
    const journal = this.readJournal(journalId);
    if (!journal) throw new PolicyDenied("POL-10", `unknown journal: ${journalId}`);
    if (journal.status === "applied" || journal.status === "rolled_back") return journal;
    if (journal.status === "applying") {
      for (const file of journal.files) {
        const target = resolve(this.projectRoot, file.path);
        if (file.previous === undefined) continue;
        if (!existsSync(target) || readFileSync(target, "utf8") !== file.next) {
          writeFileSync(target, file.previous, "utf8");
        }
      }
      journal.status = "blocked";
      return this.writeJournal(journal);
    }
    return journal;
  }

  rollback(journalId: string): ApplyJournal {
    const journal = this.readJournal(journalId);
    if (!journal) throw new PolicyDenied("POL-10", `unknown journal: ${journalId}`);
    if (journal.status !== "applied") throw new PolicyDenied("POL-10", `journal is not applied: ${journal.status}`);
    for (const file of journal.files) {
      const target = resolve(this.projectRoot, file.path);
      if (file.previous === undefined) {
        try { unlinkSync(target); } catch { /* ignore */ }
      } else {
        writeFileSync(target, file.previous, "utf8");
      }
    }
    journal.status = "rolled_back";
    this.writeJournal(journal);
    const manifest = this.candidates.read(journal.candidateId);
    manifest.status = "verified";
    this.candidates.save(manifest);
    return journal;
  }

  revoke(candidateId: string): CandidateManifest {
    const manifest = this.candidates.read(candidateId);
    manifest.status = "revoked";
    return this.candidates.save(manifest);
  }

  assertPush(authorization: AuthorizationRecord, switches: ApplySwitches = this.switches): void {
    if (!switches.allowGitPush || !authorization.allow.actions.includes("push")) {
      throw new PolicyDenied("POL-06", "git remote push is not authorized");
    }
  }

  externalRollbackClaim(): "unsupported" {
    return "unsupported";
  }

  private findByIdempotency(key: string): ApplyJournal | undefined {
    if (!existsSync(this.journals)) return undefined;
    for (const name of readdirSync(this.journals)) {
      if (!name.endsWith(".json")) continue;
      const journal = this.readJournal(name.replace(/\.json$/, ""));
      if (journal?.idempotencyKey === key) return journal;
    }
    return undefined;
  }
}
