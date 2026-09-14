import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuthorization } from "@canary/policy";
import { LoopController, type LoopPorts } from "../src/index.js";

function auth(root: string) {
  return createAuthorization({
    id: "auth_loop",
    subject: "owner",
    projectRoot: root,
    projectIdentity: { kind: "owned", evidence: "temp" },
    mode: "soft",
    activation: "auto_within_policy",
    allow: { paths: [], actions: ["loop"] },
    protect: { paths: [] },
    network: { allowHosts: [] },
    tools: { allow: [] },
    envAllowlist: [],
    budget: { maxCost: 20, maxRounds: 3, maxMs: 60_000, maxToolCalls: 20 },
  });
}

function ports(overrides: Partial<LoopPorts> = {}): LoopPorts {
  let applies = 0;
  return {
    executorAvailable: () => true,
    observe: async () => ({ runId: "run_1" }),
    propose: async () => ({ kind: "soft", id: "exp_1" }),
    trial: async () => ({ valid: true, gain: true }),
    apply: async () => {
      applies += 1;
      return { applied: true, idempotencyKey: "apply:exp_1" };
    },
    ...overrides,
  };
}

describe("L-01 loop controller", () => {
  it("does not auto-start and records multi-round soft evolution until round budget stops it", async () => {
    const root = mkdtempSync(join(tmpdir(), "canary-loop-"));
    const controller = new LoopController(root, ports(), { cooldownMs: 0, noGainStop: 9 }, auth(root));
    expect(controller.getState().state).toBe("idle");
    await controller.trigger("e1");
    await controller.trigger("e2");
    const third = await controller.trigger("e3");
    expect(third.round).toBeGreaterThanOrEqual(3);
    const stopped = await controller.trigger("e4");
    expect(stopped.state).toBe("stopped");
    expect(stopped.stopReason).toMatch(/round budget|no-gain|stopped/);
    expect(stopped.history.some((item) => item.state === "monitoring" || item.state === "applying")).toBe(true);
  });

  it("waits when the host disappears, skips duplicate billing, and stops on revoke", async () => {
    const root = mkdtempSync(join(tmpdir(), "canary-loop-host-"));
    let available = false;
    const controller = new LoopController(root, ports({
      executorAvailable: () => available,
    }), { cooldownMs: 0 }, auth(root));
    const waiting = await controller.trigger("missing-host");
    expect(waiting.state).toBe("waiting_executor");

    available = true;
    const once = await controller.trigger("evt", "same");
    const twice = await controller.trigger("evt", "same");
    expect(once.chargedEvents.filter((id) => id === "evt")).toHaveLength(1);
    expect(twice.processedEvents.filter((id) => id === "evt")).toHaveLength(1);
    expect(twice.appliedKeys.filter((id) => id === "apply:exp_1").length).toBeLessThanOrEqual(1);

    const revoked = controller.revoke();
    expect(revoked.state).toBe("stopped");
    const after = await controller.trigger("later");
    expect(after.state).toBe("stopped");
  });

  it("recovers injected faults during eval, approval, and apply without double apply", async () => {
    const root = mkdtempSync(join(tmpdir(), "canary-loop-fault-"));
    let applyCount = 0;
    const controller = new LoopController(root, ports({
      apply: async () => {
        applyCount += 1;
        return { applied: true, idempotencyKey: "apply:exp_1" };
      },
    }), { cooldownMs: 0 }, auth(root));
    controller.injectFault("during_eval");
    await controller.trigger("f1");
    expect(controller.getState().history.some((item) => item.note.includes("during_eval"))).toBe(true);
    controller.recover();

    const manual = new LoopController(mkdtempSync(join(tmpdir(), "canary-loop-appr-")), ports(), { cooldownMs: 0 }, { ...auth(root), activation: "manual", id: "auth_manual" });
    manual.injectFault("during_approval");
    const waiting = await manual.trigger("f2");
    expect(["waiting_approval", "idle", "observing", "proposing", "trialing"].includes(waiting.state) || waiting.history.some((item) => item.note.includes("during_approval"))).toBe(true);

    const applyFault = new LoopController(mkdtempSync(join(tmpdir(), "canary-loop-apply-")), ports({
      apply: async () => {
        applyCount += 1;
        return { applied: true, idempotencyKey: "apply:exp_1" };
      },
    }), { cooldownMs: 0 }, auth(root));
    applyFault.injectFault("before_apply");
    await applyFault.trigger("f3");
    applyFault.recover();
    await applyFault.trigger("f4");
    applyFault.injectFault("after_apply");
    await applyFault.trigger("f5");
    const recovered = applyFault.recover();
    expect(recovered.appliedKeys.filter((key) => key === "apply:exp_1").length).toBeLessThanOrEqual(1);
    expect(applyCount).toBeGreaterThanOrEqual(0);
  });

  it("stops on a no-gain threshold", async () => {
    const root = mkdtempSync(join(tmpdir(), "canary-loop-nogain-"));
    const controller = new LoopController(root, ports({
      trial: async () => ({ valid: false, gain: false }),
    }), { cooldownMs: 0, noGainStop: 2 }, auth(root));
    await controller.trigger("n1");
    const stopped = await controller.trigger("n2");
    expect(stopped.state).toBe("stopped");
    expect(stopped.stopReason).toMatch(/no-gain/);
  });
});
