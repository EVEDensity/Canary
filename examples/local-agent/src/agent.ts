import { feature } from "@canary/coverage";

export type AgentMode = "plan" | "lookup" | "parse" | "compute" | "recover" | "loop" | "isolate";

export interface AgentTask {
  goal: string;
  mode: AgentMode;
  token?: string;
}

export interface AgentResult {
  output: string;
  feature: string;
  recovered: boolean;
  token?: string;
  steps: number;
}

type Emit = (event: Record<string, unknown>) => void;
interface AgentRuntime {
  executionId?: string;
  emit?: Emit;
  tools?: { call(name: string, args: unknown): Promise<unknown> };
  state?: { get(key?: string): unknown; set(key: string, value: unknown): void };
  model?: { complete(prompt: string): Promise<{ text: string }> };
}

function normalize(input: unknown): AgentTask {
  if (typeof input === "string") {
    if (input.startsWith("lookup:")) return { goal: input.slice(7), mode: "lookup" };
    if (input.startsWith("parse:")) return { goal: input.slice(6), mode: "parse" };
    if (input.startsWith("compute:")) return { goal: input.slice(8), mode: "compute" };
    if (input.startsWith("recover:")) return { goal: input.slice(8), mode: "recover" };
    if (input === "loop") return { goal: "loop", mode: "loop" };
    return { goal: input, mode: "plan" };
  }
  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>;
    const mode = typeof record.mode === "string" ? record.mode as AgentMode : "plan";
    const token = typeof record.token === "string" ? record.token : undefined;
    return { goal: String(record.goal ?? token ?? ""), mode, token };
  }
  return { goal: "", mode: "plan" };
}

function emitTool(emit: Emit, name: string, args: unknown): void {
  emit({ type: "tool.call", name, args });
  emit({ type: "tool_call", name, args });
}

async function callTool(ctx: AgentRuntime, name: string, args: unknown): Promise<unknown> {
  return ctx.tools!.call(name, args);
}

function remember(ctx: AgentRuntime, emit: Emit, name: string, result: unknown): void {
  ctx.state!.set("lastTool", name);
  ctx.state!.set("lastResult", result);
  const state = ctx.state!.get();
  emit({ type: "state.changed", state });
  emit({ type: "state.snapshot", state });
}

async function route(task: AgentTask, emit: Emit, ctx: AgentRuntime): Promise<AgentResult> {
  if (task.mode === "loop") {
    emitTool(emit, "lookup", { q: task.goal });
    emitTool(emit, "lookup", { q: task.goal });
    emit({ type: "loop_detected" });
    return feature("termination", () => ({ output: "stopped:loop", feature: "termination", recovered: false, steps: 2 }));
  }
  if (task.mode === "recover") {
    return feature("error-recovery", async () => {
      emit({ type: "error", tool: "lookup" });
      try {
        await callTool(ctx, "fail", {});
      } catch {
        emit({ type: "recovery" });
      }
      const args = { q: task.goal };
      emitTool(emit, "lookup", args);
      const found = await callTool(ctx, "lookup", args);
      remember(ctx, emit, "lookup", found);
      return { output: `recovered:${found}`, feature: "error-recovery", recovered: true, steps: 2 };
    });
  }
  if (task.mode === "lookup") {
    const args = { q: task.goal };
    emitTool(emit, "lookup", args);
    const found = await callTool(ctx, "lookup", args);
    remember(ctx, emit, "lookup", found);
    return { output: String(found), feature: "tool-routing", recovered: false, steps: 1 };
  }
  if (task.mode === "parse") {
    const args = { text: task.goal };
    emitTool(emit, "parse", args);
    const parsed = await callTool(ctx, "parse", args) as { tokens: string[] };
    remember(ctx, emit, "parse", parsed);
    return { output: parsed.tokens.join(","), feature: "tool-routing", recovered: false, steps: 1 };
  }
  if (task.mode === "compute") {
    const parseArgs = { text: task.goal };
    emitTool(emit, "parse", parseArgs);
    const parsed = await callTool(ctx, "parse", parseArgs) as { tokens: string[] };
    const computeArgs = { tokens: parsed.tokens };
    emitTool(emit, "compute", computeArgs);
    const count = await callTool(ctx, "compute", computeArgs);
    remember(ctx, emit, "compute", count);
    return { output: `count:${count}`, feature: "tool-routing", recovered: false, steps: 2 };
  }
  if (task.mode === "isolate") {
    const args = { q: task.token ?? task.goal };
    emitTool(emit, "lookup", args);
    await callTool(ctx, "lookup", args);
    remember(ctx, emit, "lookup", task.token ?? task.goal);
    return { output: `isolated:${task.token ?? task.goal}`, feature: "tool-routing", recovered: false, token: task.token ?? task.goal, steps: 1 };
  }
  const planned = await ctx.model!.complete(`plan:${task.goal}`);
  return feature("termination", () => ({ output: planned.text, feature: "planning", recovered: false, token: task.token, steps: 0 }));
}

export async function runAgent(input: unknown, ctx: AgentRuntime = {}): Promise<AgentResult> {
  const emit: Emit = (event) => { ctx.emit?.({ timestamp: new Date().toISOString(), ...event }); };
  const task = normalize(input);
  return feature("planning", async () => {
    emit({ type: "plan", goal: task.goal, mode: task.mode });
    if (task.mode === "plan") return route(task, emit, ctx);
    return feature("tool-routing", () => route(task, emit, ctx));
  });
}
