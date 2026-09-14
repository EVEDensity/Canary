import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { policyDir } from "./store.js";
import { PolicyDenied } from "./paths.js";

export interface BudgetSnapshot {
  v: 1;
  projectRoot: string;
  reserved: number;
  committed: number;
  toolCalls: number;
  rounds: number;
  startedAt: string;
  maxCost: number;
  maxRounds: number;
  maxMs: number;
  maxToolCalls: number;
}

export interface BudgetReservation {
  id: string;
  amount: number;
  toolCalls: number;
}

function sleep(ms: number): void {
  const buf = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(buf, 0, 0, ms);
}

export class BudgetLedger {
  readonly file: string;
  readonly lock: string;
  constructor(projectRoot: string, limits?: Partial<Pick<BudgetSnapshot, "maxCost" | "maxRounds" | "maxMs" | "maxToolCalls">>) {
    const root = resolve(policyDir(projectRoot));
    mkdirSync(root, { recursive: true });
    this.file = resolve(root, "budget.json");
    this.lock = resolve(root, "budget.lock");
    if (!existsSync(this.file)) {
      this.write({
        v: 1,
        projectRoot: resolve(projectRoot),
        reserved: 0,
        committed: 0,
        toolCalls: 0,
        rounds: 0,
        startedAt: new Date().toISOString(),
        maxCost: limits?.maxCost ?? 100,
        maxRounds: limits?.maxRounds ?? 8,
        maxMs: limits?.maxMs ?? 3_600_000,
        maxToolCalls: limits?.maxToolCalls ?? 1_000,
      });
    }
  }

  private write(value: BudgetSnapshot): void {
    const tmp = `${this.file}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
    writeFileSync(this.file, readFileSync(tmp, "utf8"), "utf8");
    try { unlinkSync(tmp); } catch { /* ignore */ }
  }

  read(): BudgetSnapshot {
    return JSON.parse(readFileSync(this.file, "utf8")) as BudgetSnapshot;
  }

  withLock<T>(fn: () => T): T {
    const started = Date.now();
    while (true) {
      try {
        writeFileSync(this.lock, String(process.pid), { flag: "wx" });
        break;
      } catch {
        if (Date.now() - started > 8_000) throw new PolicyDenied("POL-07", "budget lock timeout");
        sleep(15);
      }
    }
    try { return fn(); }
    finally { try { unlinkSync(this.lock); } catch { /* ignore */ } }
  }

  remaining(snapshot = this.read()): number {
    return snapshot.maxCost - snapshot.reserved - snapshot.committed;
  }

  reserve(id: string, amount: number, toolCalls = 0): BudgetReservation {
    return this.withLock(() => {
      const snap = this.read();
      if (amount < 0 || toolCalls < 0) throw new PolicyDenied("POL-07", "negative budget is not allowed");
      if (snap.reserved + snap.committed + amount > snap.maxCost) {
        throw new PolicyDenied("POL-07", `budget exceeded: reserved=${snap.reserved} committed=${snap.committed} request=${amount} max=${snap.maxCost}`);
      }
      if (snap.toolCalls + toolCalls > snap.maxToolCalls) {
        throw new PolicyDenied("POL-07", "tool-call budget exceeded");
      }
      snap.reserved += amount;
      snap.toolCalls += toolCalls;
      this.write(snap);
      return { id, amount, toolCalls };
    });
  }

  commit(reservation: BudgetReservation): void {
    this.withLock(() => {
      const snap = this.read();
      snap.reserved = Math.max(0, snap.reserved - reservation.amount);
      snap.committed += reservation.amount;
      this.write(snap);
    });
  }

  release(reservation: BudgetReservation): void {
    this.withLock(() => {
      const snap = this.read();
      snap.reserved = Math.max(0, snap.reserved - reservation.amount);
      snap.toolCalls = Math.max(0, snap.toolCalls - reservation.toolCalls);
      this.write(snap);
    });
  }

  addRound(): number {
    return this.withLock(() => {
      const snap = this.read();
      if (snap.rounds + 1 > snap.maxRounds) throw new PolicyDenied("POL-07", "round budget exceeded");
      snap.rounds += 1;
      this.write(snap);
      return snap.rounds;
    });
  }

  elapsedMs(): number {
    return Date.now() - Date.parse(this.read().startedAt);
  }

  assertTime(): void {
    const snap = this.read();
    if (this.elapsedMs() > snap.maxMs) throw new PolicyDenied("POL-07", "time budget exceeded");
  }
}
