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
    if (this.checkControlRequest())