import { describe, expect, it } from "vitest";
import { mkdtempSync, existsSync, writeFileSync, linkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunSnapshot } from "@canary/core";
import { ControlPlane, type Action, type Command, quality, observeAnchor, hash } from "../src/index.js";
import { atomic, guarded } from "../src/storage.js";
import { fixtureRun } from "./fixtures.js";
function project() {
  const root = mkdtempSync(join(tmpdir(), "canary-control-"));
  const p = new ControlPlane(root);
  return { root, p, save: (r: RunSnapshot) => atomic(join(root, ".canary/artifacts", r.runId, "run.json"), r) };
}
function command(p: ControlPlane, action: Action, target: string, id = "request1"): Command {
  return {
    action,
    target,
    requestId: id,
    actor: "test operator",
    reason: "synthetic acceptance",
    expectedRevision: p.revision(action, target),
  };
}
const operator = { role: "operator" as const };
describe("L02 persistent evidence and safety", () => {
  it("reads empty legacy project without creating files and denies readers", () => {
    const { root, p } = project();
    expect(p.snapshot().runs).toEqual([]);
    expect(existsSync(join(root, ".canary"))).toBe(false);
    expect(() => p.execute({} as Command, { role: "reader" })).toThrow(/Read-only/);
    expect(existsSync(join(root, ".canary"))).toBe(false);
  });
  it("binds versions, replays completed receipt across restart, rejects changed request IDs", () => {
    const { root, p, save } = project();
    save(fixtureRun());
    const c = command(p, "anchor.create", "baseline");
    p.execute(c, operator);
    expect(new ControlPlane(root).execute(c, operator).id).toBe(c.requestId);
    expect(p.state().anchors).toHaveLength(1);
    expect(() => p.execute({ ...c, reason: "changed" }, operator)).toThrow(/reused/);
    expect(() => p.execute({ ...c, requestId: "new" }, operator)).toThrow(/version changed/);
    expect(new ControlPlane(root).audit()[0]?.status).toBe("completed");
  });
  it("refuses modified evidence after review", () => {
    const { p, save } = project();
    save(fixtureRun());
    const c = command(p, "anchor.create", "baseline");
    save(fixtureRun("baseline", 1));
    expect(() => p.execute(c, operator)).toThrow(/version changed/);
  });
  it("detects cumulative small regression against fixed anchor, never adjacent-only", () => {
    const b = fixtureRun();
    const a = { id: "a", runId: b.runId, fingerprint: hash(b), threshold: 2, createdAt: b.startedAt };
    const points = observeAnchor(a, [b, fixtureRun("one", 1), fixtureRun("two", 2), fixtureRun("three", 3)]).points;
    expect(points.map((p) => p.passDelta)).toEqual([-1, -2, -3]);
    expect(points[2]?.drift).toBe("detected");
    const changed = fixtureRun("other");
    changed.results[0]!.sourceCase!.input = "different";
    expect(observeAnchor(a, [b, changed]).points[0]?.passDelta).toBeNull();
    expect(observeAnchor(a, [fixtureRun("baseline", 1), fixtureRun("one")]).intact).toBe(false);
  });
  it("keeps absent/stub/low confidence Judge and incomplete runs unavailable", () => {
    expect(quality(fixtureRun()).judgeScore).toBeNull();
    const r = fixtureRun("baseline", 0, 0.9);
    expect(quality(r).judgeScore).toBeCloseTo(0.9);
    r.results[0]!.assertions[0]!.details = { provider: "fake", stub: true, verdict: "pass", score: 1 };
    expect(quality(r).judgeScore).toBeNull();
    r.results[0]!.assertions[0]!.details = { provider: "real", confidence: 0.1, verdict: "pass", score: 1 };
    expect(quality(r).judgeScore).toBeNull();
    r.status = "running";
    expect(quality(r).passRate).toBeNull();
  });
  it("rotates fresh holdout, refuses reuse, persists hashed exposure and overlap risk", () => {
    const { p, save } = project();
    save(fixtureRun());
    p.execute(command(p, "holdout.rotate", "baseline"), operator);
    expect(() => p.execute(command(p, "holdout.rotate", "baseline", "reuse"), operator)).toThrow(/reuse/);
    const epoch = p.state().epochs[0]!;
    p.execute(
      {
        ...command(p, "holdout.exposure", epoch.id, "expose"),
        channel: "proposal",
        reference: "sensitive raw reference",
      },
      operator,
    );
    expect(p.snapshot().leakage[0]?.status).toBe("risk_detected");
    expect(JSON.stringify(p.snapshot())).not.toContain("sensitive raw reference");
    const fresh = fixtureRun("fresh");
    fresh.results[99]!.caseId = "fresh-holdout";
    fresh.results[99]!.sourceCase!.input = "fresh input";
    save(fresh);
    p.execute(command(p, "holdout.rotate", "fresh", "rotate2"), operator);
    expect(p.state().epochs[0]?.retiredAt).toBeTruthy();
  });
  it("blocks ambiguous pending requests without repeating side effects", () => {
    const { root, p, save } = project();
    save(fixtureRun());
    const c = command(p, "anchor.create", "baseline");
    atomic(join(root, ".canary/control-plane/audit/pending.json"), {
      id: "pending",
      status: "pending",
      at: "2026-09-14",
    });
    expect(() => p.execute(c, operator)).toThrow(/reconciliation/);
    expect(p.state().anchors).toEqual([]);
    actReconcile(p);
    expect(p.audit().find((a) => a.id === "pending")?.resolution?.reason).toBe("manually checked no effect");
    p.execute(c, operator);
    expect(p.state().anchors).toHaveLength(1);
  });
  it("rejects reconciliation evidence after original audit tampering", () => {
    const { root, p } = project();
    const path = join(root, ".canary/control-plane/audit/pending.json");
    atomic(path, { id: "pending", status: "pending", at: "2026-09-14" });
    actReconcile(p);
    atomic(path, { id: "pending", status: "pending", at: "2026-09-15" });
    expect(() => p.audit()).toThrow(/evidence changed/);
  });
  it("refuses holdout rotation without known input identity", () => {
    const { p, save } = project();
    const run = fixtureRun();
    delete run.results[99]!.sourceCase!.input;
    delete run.results[99]!.input;
    save(run);
    expect(() => p.execute(command(p, "holdout.rotate", "baseline"), operator)).toThrow(/Rotation needs/);
  });
  it("denies escaped and hard-linked evidence paths", () => {
    const { root } = project();
    expect(() => guarded(root, "../outside")).toThrow(/escapes/);
    writeFileSync(join(root, "one"), "safe");
    linkSync(join(root, "one"), join(root, "two"));
    expect(() => guarded(root, "two")).toThrow(/Linked/);
  });
  it("preserves authorization DTO structure and never returns raw run output or input", () => {
    const { p, save } = project();
    const r = fixtureRun();
    r.results[0]!.output = "sensitive output";
    save(r);
    expect(Array.isArray(p.snapshot().authorizations)).toBe(true);
    expect(JSON.stringify(p.snapshot())).not.toContain("sensitive output");
    expect(JSON.stringify(p.snapshot())).not.toContain("synthetic-99");
  });
  it("shows the actual case selection for a loaded experience without exposing its content", () => {
    const { p, save } = project();
    const run = fixtureRun();
    run.experiences = [{ id: "experience_one", key: "case-rule", version: 2, contentHash: "a".repeat(64), loadedAt: run.startedAt, selection: { caseIds: ["case-one"] } }];
    save(run);
    expect(p.snapshot().runs[0]?.loadedExperiences).toEqual([{ id: "experience_one", version: 2, contentHash: "a".repeat(64), selection: { caseIds: ["case-one"] } }]);
  });
});

function actReconcile(p: ControlPlane) {
  p.execute(
    { ...command(p, "audit.reconcile", "pending", "reconcile"), reason: "manually checked no effect" },
    operator,
  );
}
