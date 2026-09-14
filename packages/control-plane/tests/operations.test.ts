import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExperienceStore } from "@canary/experience";
import { AuthorizationStore, PolicyStore, createAuthorization, defaultPolicy } from "@canary/policy";
import { CandidateWorkspace, TrustedApplyer, projectBaselineHash, verifyCandidate } from "@canary/hard-evolution";
import { ControlPlane, type Action } from "../src/index.js";
import { atomic } from "../src/storage.js";
import { fixtureRun } from "./fixtures.js";
const op = { role: "operator" as const };
function act(p: ControlPlane, action: Action, target: string, id: string) {
  return p.execute(
    {
      action,
      target,
      requestId: id,
      actor: "owner",
      reason: "acceptance",
      expectedRevision: p.revision(action, target),
    },
    op,
  );
}
function soft() {
  const root = mkdtempSync(join(tmpdir(), "canary-soft-control-")),
    p = new ControlPlane(root),
    store = new ExperienceStore(join(root, ".canary/experiences"));
  const exp = store.propose({
    key: "fix",
    projectRoot: root,
    source: { kind: "human" },
    summary: "Fixture",
    content: "Check input before responding.",
  });
  store.transition(exp.id, "validated");
  const baseline = fixtureRun("baseline", 1),
    candidate = fixtureRun("candidate");
  atomic(join(root, ".canary/artifacts/baseline/run.json"), baseline);
  atomic(join(root, ".canary/artifacts/candidate/run.json"), candidate);
  const trial = {
    v: 1,
    id: "trial",
    projectRoot: root,
    configPath: join(root, "canary.config.ts"),
    baselineRunId: "baseline",
    experienceId: exp.id,
    experienceContentHash: exp.contentHash,
    datasetIdentity: "fixture",
    regressionCaseIds: ["case0"],
    holdoutCaseIds: ["case99"],
    budget: { maxCases: 100, maxChars: 8000 },
    status: "validated",
    authorization: { status: "not_approved" },
    validation: {
      valid: true,
      reasons: [],
      candidateRunId: "candidate",
      comparisonArtifact: "comparison.json",
      regressionCaseIds: ["case0"],
      holdoutCaseIds: ["case99"],
      validatedAt: new Date().toISOString(),
    },
  };
  const file = join(root, ".canary/artifacts/soft-trials/trial/trial.json");
  atomic(file, trial);
  return { root, p, store, exp, trial, file };
}
function hard() {
  const root = mkdtempSync(join(tmpdir(), "canary-hard-control-"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src/agent.js"), "original");
  const policy = defaultPolicy(root);
  policy.allowPaths = ["src"];
  policy.isolation.osRequiredForAutoHard = false;
  new PolicyStore(root).save(policy);
  const auth = createAuthorization({
    id: "auth",
    subject: "owner",
    projectRoot: root,
    projectIdentity: { kind: "owned", evidence: "test" },
    mode: "hard",
    activation: "manual",
    allow: { paths: ["src"], actions: ["write", "apply"] },
    protect: { paths: [] },
    network: { allowHosts: [] },
    tools: { allow: [] },
    envAllowlist: [],
    budget: { maxCost: 10, maxRounds: 5, maxMs: 60000, maxToolCalls: 10 },
    policyVersion: policy.version,
  });
  new AuthorizationStore(root).save(auth);
  const ws = new CandidateWorkspace(root);
  ws.prepare({
    id: "candidate",
    authorization: auth,
    policy,
    baselineHash: projectBaselineHash(root),
    files: [{ path: "src/agent.js", content: "updated" }],
  });
  verifyCandidate({
    workspace: ws,
    candidateId: "candidate",
    baseline: fixtureRun("baseline", 1),
    candidate: fixtureRun("candidate"),
  });
  return { root, auth, policy, p: new ControlPlane(root) };
}
describe("L02 protected operations", () => {
  it("approves independent soft evidence, revalidates on use, and revokes", () => {
    const { p, root } = soft();
    act(p, "soft.approve", "trial", "approve");
    new ControlPlane(root).assertSoftApproval("trial");
    act(p, "soft.revoke", "trial", "revoke");
    expect(() => p.assertSoftApproval("trial")).toThrow(/changed or revoked/);
  });
  it("refuses a soft trial with no independent holdout", () => {
    const { p, trial, file } = soft();
    atomic(file, { ...trial, holdoutCaseIds: [] });
    expect(() => act(p, "soft.approve", "trial", "bad")).toThrow(/regression\/holdout/);
  });
  it("detects candidate result tampering after soft approval", () => {
    const { p, root } = soft();
    act(p, "soft.approve", "trial", "approve");
    atomic(join(root, ".canary/artifacts/candidate/run.json"), fixtureRun("candidate", 2));
    expect(() => p.assertSoftApproval("trial")).toThrow(/changed/);
  });
  it("restores the exact previous experience pointer", () => {
    const { p, store, exp, file, trial, root } = soft();
    act(p, "soft.approve", "trial", "approve");
    const priorActive = store.activePointer(root);
    store.activate(exp.id);
    atomic(file, { ...trial, status: "activated", priorActive });
    act(p, "soft.rollback", "trial", "rollback");
    expect(store.activePointer(root).entries).toEqual([]);
    expect(p.snapshot().trials[0]?.status).toBe("rolled_back");
  });
  it("approves hard evidence and rolls back only unchanged applied source", () => {
    const { p, root, auth } = hard();
    act(p, "hard.approve", "candidate", "approve");
    const journal = new TrustedApplyer(root).apply({
      candidateId: "candidate",
      authorization: auth,
      switches: { mode: "hard", activation: "manual" },
    });
    writeFileSync(join(root, "src/agent.js"), "user change");
    expect(() => act(p, "hard.rollback", journal.id, "deny")).toThrow(/Source changed/);
    expect(readFileSync(join(root, "src/agent.js"), "utf8")).toBe("user change");
    writeFileSync(join(root, "src/agent.js"), "updated");
    act(p, "hard.rollback", journal.id, "rollback");
    expect(readFileSync(join(root, "src/agent.js"), "utf8")).toBe("original");
  });
  it.each(["expired", "revoked", "policy"])("rejects %s hard authorization", (kind) => {
    const { p, root, auth, policy } = hard();
    if (kind === "policy") new PolicyStore(root).save({ ...policy, version: "changed" });
    else
      new AuthorizationStore(root).save({
        ...auth,
        ...(kind === "revoked" ? { revoked: true } : { expiresAt: "2000-01-01T00:00:00Z" }),
      });
    expect(() => act(p, "hard.approve", "candidate", "deny")).toThrow(/expired|revoked|Policy version/);
  });
  it("revokes authorization and candidate durably without applying source", () => {
    const { p, root } = hard();
    act(p, "hard.revoke", "candidate", "candidate-revoke");
    act(p, "authorization.revoke", "auth", "auth-revoke");
    expect(new ControlPlane(root).snapshot().authorizations[0]?.revoked).toBe(true);
    expect(readFileSync(join(root, "src/agent.js"), "utf8")).toBe("original");
  });
  it("refuses candidate tree tampering", () => {
    const { p, root } = hard();
    writeFileSync(join(root, ".canary/candidates/candidate/tree/src/agent.js"), "swapped");
    expect(() => act(p, "hard.approve", "candidate", "swap")).toThrow(/changed after verification/);
  });
  it("refuses stale hard approval revisions after policy changes", () => {
    const { p, root, policy } = hard();
    const revision = p.revision("hard.approve", "candidate");
    new PolicyStore(root).save({ ...policy, protect: [...policy.protect, "src"] });
    expect(() =>
      p.execute(
        {
          action: "hard.approve",
          target: "candidate",
          requestId: "stale",
          actor: "owner",
          reason: "old review",
          expectedRevision: revision,
        },
        op,
      ),
    ).toThrow(/version changed/);
  });
});
