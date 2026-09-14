import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthorizationRecord, EvalResult, CoverageSummary } from "@canary/core";
import { PolicyDenied, PolicyStore, createAuthorization, defaultPolicy } from "@canary/policy";
import { CandidateWorkspace, TrustedApplyer, enqueueIfVerified, projectBaselineHash, verifyCandidate } from "../src/index.js";

const coverage = (runId: string): CoverageSummary => ({
  runId, sourceHash: "h", status: "final",
  lines: { covered: 1, total: 1, pct: 100 },
  statements: { covered: 1, total: 1, pct: 100 },
  functions: { covered: 1, total: 1, pct: 100 },
  branches: { covered: 1, total: 1, pct: 100 },
  featureChains: [],
});

function evalResult(runId: string, caseId: string, passed: boolean): EvalResult {
  return { runId, executionId: `e_${caseId}`, caseId, passed, assertions: [], coverage: coverage(runId), createdAt: new Date().toISOString() };
}

function project(): { root: string; auth: AuthorizationRecord } {
  const root = mkdtempSync(join(tmpdir(), "canary-hard-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "agent.js"), "export default async (input) => ({ ok: false, value: input });\n");
  writeFileSync(join(root, "canary.config.ts"), "export default { coverage: { lines: 80 } };\n");
  mkdirSync(join(root, "cases"), { recursive: true });
  writeFileSync(join(root, "cases", "broken.ts"), "export default { id: 'broken' };\n");
  const policy = defaultPolicy(root);
  policy.isolation.osRequiredForAutoHard = false;
  policy.allowPaths = ["src"];
  new PolicyStore(root).save(policy);
  const auth = createAuthorization({
    id: "auth_hard",
    subject: "owner",
    projectRoot: root,
    projectIdentity: { kind: "owned", evidence: "temp-workspace" },
    mode: "hard",
    activation: "auto_within_policy",
    allow: { paths: ["src"], actions: ["write", "apply"] },
    protect: { paths: ["cases", "canary.config.ts"] },
    network: { allowHosts: [] },
    tools: { allow: [] },
    envAllowlist: policy.envAllowlist,
    budget: { maxCost: 20, maxRounds: 4, maxMs: 60_000, maxToolCalls: 20 },
  });
  return { root, auth };
}

describe("H-02 candidate workspace", () => {
  it("creates a candidate for a known defect and rejects protected or expanded edits", () => {
    const { root, auth } = project();
    const ws = new CandidateWorkspace(root);
    const policy = new PolicyStore(root).load()!;
    const baseline = projectBaselineHash(root);
    const prepared = ws.prepare({
      id: "cand_ok",
      authorization: auth,
      policy,
      baselineHash: baseline,
      files: [{ path: "src/agent.js", content: "export default async (input) => ({ ok: true, value: input });\n" }],
    });
    expect(prepared.status).toBe("prepared");
    expect(prepared.files[0]?.diff).toContain("src/agent.js");

    expect(() => ws.prepare({
      id: "cand_test",
      authorization: auth,
      policy,
      baselineHash: baseline,
      files: [{ path: "cases/broken.ts", content: "export default { id: 'broken', skip: true };\n" }],
    })).toThrow(PolicyDenied);

    expect(() => ws.prepare({
      id: "cand_threshold",
      authorization: auth,
      policy,
      baselineHash: baseline,
      files: [{ path: "canary.config.ts", content: "export default { coverage: { lines: 0 } };\n" }],
    })).toThrow(PolicyDenied);

    expect(() => ws.prepare({
      id: "cand_wide",
      authorization: auth,
      policy,
      baselineHash: baseline,
      files: [{ path: "README.md", content: "owned" }],
    })).toThrow(/outside the authorized change surface/);

    expect(() => ws.prepare({
      id: "cand_pkg",
      authorization: auth,
      policy,
      baselineHash: baseline,
      files: [{ path: "package.json", content: "{}" }],
    })).toThrow(/dependency\/build/);
  });

  it("rejects forged reports and uncertain results from the apply queue", () => {
    const { root, auth } = project();
    const ws = new CandidateWorkspace(root);
    const policy = new PolicyStore(root).load()!;
    ws.prepare({
      id: "cand_ev",
      authorization: auth,
      policy,
      baselineHash: projectBaselineHash(root),
      files: [{ path: "src/agent.js", content: "export default async (input) => ({ ok: true, value: input });\n" }],
    });
    const forged = verifyCandidate({
      workspace: ws,
      candidateId: "cand_ev",
      baseline: { runId: "b", results: [evalResult("b", "broken", false)] },
      candidate: { runId: "c", results: [evalResult("c", "broken", true)] },
      forgedReport: { approved: true, verified: true },
    });
    expect(forged.status).toBe("rejected");
    expect(forged.verification?.candidateReportIgnored).toBe(true);

    ws.prepare({
      id: "cand_ok2",
      authorization: auth,
      policy,
      baselineHash: projectBaselineHash(root),
      files: [{ path: "src/agent.js", content: "export default async (input) => ({ ok: true, value: input });\n" }],
    });
    const verified = verifyCandidate({
      workspace: ws,
      candidateId: "cand_ok2",
      baseline: { runId: "b", results: [evalResult("b", "broken", false)] },
      candidate: { runId: "c", results: [evalResult("c", "broken", true)] },
    });
    expect(verified.status).toBe("verified");
    expect(enqueueIfVerified(ws, "cand_ok2").status).toBe("queued");

    ws.prepare({
      id: "cand_fail",
      authorization: auth,
      policy,
      baselineHash: projectBaselineHash(root),
      files: [{ path: "src/agent.js", content: "export default async () => ({ ok: false });\n" }],
    });
    const failed = verifyCandidate({
      workspace: ws,
      candidateId: "cand_fail",
      baseline: { runId: "b", results: [evalResult("b", "broken", false)] },
      candidate: { runId: "c", results: [evalResult("c", "broken", false)] },
    });
    expect(failed.status).toBe("rejected");
    expect(() => enqueueIfVerified(ws, "cand_fail")).toThrow(/unverified|queue/);
  });

  it("does not treat an open-source label as write authorization", () => {
    const { root, auth } = project();
    const ws = new CandidateWorkspace(root);
    const policy = new PolicyStore(root).load()!;
    const oss = { ...auth, projectIdentity: { kind: "public_github" as AuthorizationRecord["projectIdentity"]["kind"], evidence: "stars" } };
    expect(() => ws.prepare({
      id: "cand_oss",
      authorization: oss,
      policy,
      baselineHash: projectBaselineHash(root),
      files: [{ path: "src/agent.js", content: "ok" }],
    })).toThrow(/open-source labels|write authorization/);
  });
});

describe("H-03 trusted applyer", () => {
  it("applies a verified hard candidate, refuses soft writes, and rolls back", () => {
    const { root, auth } = project();
    const ws = new CandidateWorkspace(root);
    const policy = new PolicyStore(root).load()!;
    const original = readFileSync(join(root, "src", "agent.js"), "utf8");
    ws.prepare({
      id: "cand_apply",
      authorization: auth,
      policy,
      baselineHash: projectBaselineHash(root),
      files: [{ path: "src/agent.js", content: "export default async (input) => ({ ok: true, value: input });\n" }],
    });
    verifyCandidate({
      workspace: ws,
      candidateId: "cand_apply",
      baseline: { runId: "b", results: [evalResult("b", "broken", false)] },
      candidate: { runId: "c", results: [evalResult("c", "broken", true)] },
    });
    const applyer = new TrustedApplyer(root, { mode: "hard", activation: "manual" });
    applyer.approve({ candidateId: "cand_apply", actor: "reviewer", reason: "independent improve", authorization: auth });
    expect(() => applyer.apply({ candidateId: "cand_apply", authorization: auth, switches: { mode: "soft", activation: "manual" } })).toThrow(/soft mode cannot write/);
    const journal = applyer.apply({ candidateId: "cand_apply", authorization: auth, switches: { mode: "hard", activation: "manual" } });
    expect(journal.status).toBe("applied");
    expect(readFileSync(join(root, "src", "agent.js"), "utf8")).toContain("ok: true");
    const again = applyer.apply({ candidateId: "cand_apply", authorization: auth, switches: { mode: "hard", activation: "manual" }, idempotencyKey: journal.idempotencyKey });
    expect(again.status).toBe("applied");
    applyer.rollback(journal.id);
    expect(readFileSync(join(root, "src", "agent.js"), "utf8")).toBe(original);
    expect(applyer.externalRollbackClaim()).toBe("unsupported");
  });

  it("blocks expired, revoked, drifted, conflicting, and swapped packages, and refuses push", () => {
    const { root, auth } = project();
    const ws = new CandidateWorkspace(root);
    const policy = new PolicyStore(root).load()!;
    ws.prepare({
      id: "cand_block",
      authorization: auth,
      policy,
      baselineHash: projectBaselineHash(root),
      files: [{ path: "src/agent.js", content: "export default async (input) => ({ ok: true, value: input });\n" }],
    });
    verifyCandidate({
      workspace: ws,
      candidateId: "cand_block",
      baseline: { runId: "b", results: [evalResult("b", "broken", false)] },
      candidate: { runId: "c", results: [evalResult("c", "broken", true)] },
    });
    const applyer = new TrustedApplyer(root, { mode: "hard", activation: "manual" });
    applyer.approve({ candidateId: "cand_block", actor: "reviewer", reason: "ok", authorization: auth });

    const expired = { ...auth, expiresAt: "2000-01-01T00:00:00.000Z" };
    expect(() => applyer.apply({ candidateId: "cand_block", authorization: expired, switches: { mode: "hard", activation: "manual" } })).toThrow(/expired/);

    writeFileSync(join(root, "src", "agent.js"), "changed-by-user\n");
    expect(() => applyer.apply({ candidateId: "cand_block", authorization: auth, switches: { mode: "hard", activation: "manual" } })).toThrow(/conflicting|drifted|uncommitted/);

    const { root: root2, auth: auth2 } = project();
    const ws2 = new CandidateWorkspace(root2);
    const policy2 = new PolicyStore(root2).load()!;
    ws2.prepare({
      id: "cand_rev",
      authorization: auth2,
      policy: policy2,
      baselineHash: projectBaselineHash(root2),
      files: [{ path: "src/agent.js", content: "export default async (input) => ({ ok: true, value: input });\n" }],
    });
    verifyCandidate({
      workspace: ws2,
      candidateId: "cand_rev",
      baseline: { runId: "b", results: [evalResult("b", "broken", false)] },
      candidate: { runId: "c", results: [evalResult("c", "broken", true)] },
    });
    const applyer2 = new TrustedApplyer(root2, { mode: "hard", activation: "manual" });
    applyer2.approve({ candidateId: "cand_rev", actor: "reviewer", reason: "ok", authorization: auth2 });
    applyer2.revoke("cand_rev");
    expect(() => applyer2.apply({ candidateId: "cand_rev", authorization: auth2, switches: { mode: "hard", activation: "manual" } })).toThrow(/revoked/);

    const { root: root3, auth: auth3 } = project();
    const ws3 = new CandidateWorkspace(root3);
    const policy3 = new PolicyStore(root3).load()!;
    const prepared = ws3.prepare({
      id: "cand_swap",
      authorization: auth3,
      policy: policy3,
      baselineHash: projectBaselineHash(root3),
      files: [{ path: "src/agent.js", content: "export default async (input) => ({ ok: true, value: input });\n" }],
    });
    verifyCandidate({
      workspace: ws3,
      candidateId: "cand_swap",
      baseline: { runId: "b", results: [evalResult("b", "broken", false)] },
      candidate: { runId: "c", results: [evalResult("c", "broken", true)] },
    });
    const applyer3 = new TrustedApplyer(root3, { mode: "hard", activation: "manual" });
    applyer3.approve({ candidateId: "cand_swap", actor: "reviewer", reason: "ok", authorization: auth3 });
    writeFileSync(join(prepared.workspace, "tree", "src", "agent.js"), "swapped-after-verify\n");
    expect(() => applyer3.apply({ candidateId: "cand_swap", authorization: auth3, switches: { mode: "hard", activation: "manual" } })).toThrow(/changed after verification|approved hash/);

    expect(() => applyer.assertPush(auth)).toThrow(/push is not authorized/);
  });

  it("auto-applies inside policy when isolation is satisfied and recovers a crash without double apply", () => {
    const { root, auth } = project();
    const ws = new CandidateWorkspace(root);
    const policy = new PolicyStore(root).load()!;
    ws.prepare({
      id: "cand_auto",
      authorization: auth,
      policy,
      baselineHash: projectBaselineHash(root),
      files: [{ path: "src/agent.js", content: "export default async (input) => ({ ok: true, value: input });\n" }],
    });
    verifyCandidate({
      workspace: ws,
      candidateId: "cand_auto",
      baseline: { runId: "b", results: [evalResult("b", "broken", false)] },
      candidate: { runId: "c", results: [evalResult("c", "broken", true)] },
    });
    const applyer = new TrustedApplyer(root, { mode: "hard", activation: "auto_within_policy" });
    const journal = applyer.apply({ candidateId: "cand_auto", authorization: auth, switches: { mode: "hard", activation: "auto_within_policy" } });
    expect(journal.status).toBe("applied");
    const recovered = applyer.recover(journal.id);
    expect(recovered.status).toBe("applied");
    const second = applyer.apply({ candidateId: "cand_auto", authorization: auth, switches: { mode: "hard", activation: "auto_within_policy" }, idempotencyKey: journal.idempotencyKey });
    expect(second.id).toBe(journal.id);
  });
});
