import { describe, expect, it } from "vitest";
import { ExecutionEnvironment, MemoryStateStore } from "../src/index.js";

describe("memory state store and snapshots", () => {
  it("sets, snapshots, restores and resets isolated state", async () => {
    const store = new MemoryStateStore({ token: "alpha" });
    expect(store.get("token")).toBe("alpha");
    store.set("token", "beta");
    const snap = store.snapshot();
    expect(snap.state.token).toBe("beta");
    store.set("token", "gamma");
    store.restore(snap.id);
    expect(store.get("token")).toBe("beta");
    store.reset({ token: "alpha" });
    expect(store.get()).toEqual({ token: "alpha" });
    expect(() => store.restore("missing")).toThrow(/Unknown snapshot/);
    expect(store.externalRollback).toBe("unsupported");
  });

  it("wraps tools in an execution environment that resets and closes", async () => {
    const calls: string[] = [];
    const tools = {
      async call(name: string, args: unknown) { calls.push(name); return args; },
      async close() { calls.push("close"); },
    };
    const state = new MemoryStateStore({ n: 1 });
    const env = new ExecutionEnvironment(tools, state, { n: 1 });
    state.set("n", 2);
    const snap = await env.snapshot();
    expect(snap.state.n).toBe(2);
    await env.reset();
    expect(state.get("n")).toBe(1);
    await env.restore(snap.id);
    expect(state.get("n")).toBe(2);
    await env.close();
    expect(calls.at(-1)).toBe("close");
  });
});
