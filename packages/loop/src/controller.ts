import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AuthorizationRecord } from "@canary/core";
import { BudgetLedger, PolicyDenied, isAuthorizationLive } from "@canary/policy";

export type LoopState =
  | "idle"
  | "observing"
  | "proposing"
  | "trialing"
  | "waiting_approval"
  | "waiting_executor"
  | "applying"
  | "monitoring"
  | "stopped"
  | "human_takeover";

export type LoopFault = "during_eval" | "during_approval" | "before_apply" | "after_apply";

export interface LoopSnapshot {
  v: 1;
  projectRoot: string;
  state: LoopState;
  round: number;
  noGainStreak: number;
  lastTriggerKey?: string;
  lastTriggerAt?: string;
  cooldownUntil?: number;
  lease?: { owner: string; until: number };
  stopReason?: string;
  processedEvents: string[];
  appliedKeys: string[];
  chargedEvents: string[];
  hostAvailable: boolean;
  authorizationId?: string;
  lastCandidateId?: string;
  fault?: LoopFault;
  history: Array<{ round: number; state: LoopState; note: string; at: string }>;
}

export interface LoopPorts {
  executorAvailable(): boolean;
  observe(): Promise<{ runId: string; improved?: boolean }>;
  propose(): Promise<{ kind: "soft" | "hard"; id: string } | undefined>;
  trial(id: string): Promise<{ valid: boolean; gain: boolean }>;
  apply(id: string): Promise<{ applied: boolean; idempotencyKey: string }>;
}

export interface LoopLimits {
  cooldownMs: number;
  noGainStop: number;
  leaseMs: number;
}

const DEFAULT_LIMITS: LoopLimits = { cooldownMs: 50, noGainStop: 2, leaseMs: 5_000 };

export class LoopController {
  readonly dir: string;
  readonly ledger: BudgetLedger;
  readonly ports: LoopPorts;
  readonly limits: LoopLimits;
  authorization?: AuthorizationRecord;
  private snapshot: LoopSnapshot;

  constructor(projectRoot: string, ports: LoopPorts, limits: Partial<LoopLimits> = {}, authorization?: AuthorizationRecord) {
    this.dir = resolve(projectRoot, ".canary", "loop");
    mkdirSync(this.dir, { recursive: true });
    this.ledger = new BudgetLedger(projectRoot, authorization ? {
      maxCost: authorization.budget.maxCost,
      maxRounds: authorization.budget.maxRounds,
      maxMs: authorization.budget.maxMs,
      maxToolCalls: authorization.budget.maxToolCalls,
    } : undefined);
    this.ports = ports;
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.authorization = authorization;
    this.snapshot = this.load() ?? {
      v: 1,
      projectRoot: resolve(projectRoot),
      state: "idle",
      round: 0,
      noGainStreak: 0,
      processedEvents: [],
      appliedKeys: [],
      chargedEvents: [],
      hostAvailable: true,
      authorizationId: authorization?.id,
      history: [],
    };
    this.persist();
  }

  stateFile(): string { return resolve(this.dir, "state.json"); }
  leaseFile(): string { return resolve(this.dir, "lease.json"); }

  getState(): LoopSnapshot { return JSON.parse(JSON.stringify(this.snapshot)) as LoopSnapshot; }

  injectFault(fault: LoopFault): void {
    this.snapshot.fault = fault;
    this.note("idle", `fault injected: ${fault}`);
    this.persist();
  }

  takeover(reason: string): LoopSnapshot {
    this.snapshot.state = "human_takeover";
    this.snapshot.stopReason = reason;
    this.note("human_takeover", reason);
    this.persist();
    return this.getState();
  }

  stop(reason: string): LoopSnapshot {
    this.snapshot.state = "stopped";
    this.snapshot.stopReason = reason;
    this.releaseLease();
    this.note("stopped", reason);
    this.persist();
    return this.getState();
  }

  revoke(): LoopSnapshot {
    if (this.authorization) this.authorization = { ...this.authorization, revoked: true, revokeId: this.authorization.revokeId ?? "loop-revoke" };
    return this.stop("authorization revoked; subsequent loop actions blocked");
  }

  async trigger(eventId: string, triggerKey = eventId): Promise<LoopSnapshot> {
    if (this.checkControlRequest()) return this.getState();
    if (this.snapshot.state === "stopped" || this.snapshot.state === "human_takeover") return this.getState();
    if (this.snapshot.processedEvents.includes(eventId)) return this.getState();
    this.snapshot.processedEvents.push(eventId);

    if (this.authorization) {
      const live = isAuthorizationLive(this.authorization);
      if (!live.ok) return this.stop(live.reason);
    }

    const now = Date.now();
    if (this.snapshot.cooldownUntil && now < this.snapshot.cooldownUntil && this.snapshot.lastTriggerKey === triggerKey) {
      this.note(this.snapshot.state, "cooldown skipped duplicate trigger");
      this.persist();
      return this.getState();
    }

    if (!this.acquireLease()) throw new PolicyDenied("POL-07", "loop lease is held by another controller");
    if (!this.ports.executorAvailable()) {
      this.snapshot.state = "waiting_executor";
      this.snapshot.hostAvailable = false;
      this.note("waiting_executor", "executor/host unavailable");
      this.persist();
      return this.getState();
    }
    this.snapshot.hostAvailable = true;

    try {
      this.ledger.assertTime();
      const round = this.ledger.addRound();
      this.snapshot.round = round;
      const reservation = this.ledger.reserve(eventId, 1, 1);
      if (!this.snapshot.chargedEvents.includes(eventId)) this.snapshot.chargedEvents.push(eventId);

      this.snapshot.state = "observing";
      if (this.snapshot.fault === "during_eval") throw new Error("injected fault during_eval");
      await this.ports.observe();

      this.snapshot.state = "proposing";
      if (this.checkControlRequest()) { this.ledger.release(reservation); return this.getState(); }
      const proposal = await this.ports.propose();
      if (this.checkControlRequest()) { this.ledger.release(reservation); return this.getState(); }
      if (!proposal) {
        this.snapshot.noGainStreak += 1;
        this.maybeStopNoGain();
        this.ledger.release(reservation);
        this.finishTrigger(triggerKey);
        return this.getState();
      }
      this.snapshot.lastCandidateId = proposal.id;

      this.snapshot.state = "trialing";
      const trial = await this.ports.trial(proposal.id);
      if (this.checkControlRequest()) { this.ledger.release(reservation); return this.getState(); }
      if (!trial.valid) {
        this.snapshot.noGainStreak += 1;
        this.ledger.release(reservation);
        this.maybeStopNoGain();
        this.finishTrigger(triggerKey);
        return this.getState();
      }

      if (this.authorization?.activation === "manual" || proposal.kind === "hard" && this.authorization?.activation !== "auto_within_policy") {
        this.snapshot.state = "waiting_approval";
        if (this.snapshot.fault === "during_approval") throw new Error("injected fault during_approval");
        this.ledger.release(reservation);
        this.finishTrigger(triggerKey);
        return this.getState();
      }

      if (this.snapshot.fault === "before_apply") throw new Error("injected fault before_apply");
      this.snapshot.state = "applying";
      const applied = await this.ports.apply(proposal.id);
      if (this.snapshot.appliedKeys.includes(applied.idempotencyKey)) {
        this.note("applying", "idempotent skip");
      } else {
        this.snapshot.appliedKeys.push(applied.idempotencyKey);
      }
      if (this.snapshot.fault === "after_apply") throw new Error("injected fault after_apply");
      this.ledger.commit(reservation);
      this.snapshot.noGainStreak = trial.gain ? 0 : this.snapshot.noGainStreak + 1;
      this.snapshot.state = "monitoring";
      if (this.checkControlRequest()) return this.getState();
      this.maybeStopNoGain();
      this.finishTrigger(triggerKey);
      return this.getState();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.note(this.snapshot.state, message);
      if (error instanceof PolicyDenied) return this.stop(message);
      this.persist();
      