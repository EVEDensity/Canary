import { feature } from "@canary/coverage";
import { compute, failTool, lookup, parse } from "./tools.js";

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

function emitTool(emit: Emit, name: string, extra: Record<string, unknown> = {}): void {
  emit({ type: "tool.call", name, ...extra });
  emit({ type: "tool_call", name, ...extra });
}

function route(task: AgentTask, emit: Emit): AgentResult {
  if (task.mode === "loop") {
    emitTool(emit, "lookup");
    emitTool(emit, "lookup");
    emit({ type: "loop_detected" });
    return feature("termination", () => ({ output: "stopped:loop", feature: "termination", recovered: false, steps: 2 }));
  }
  if (task.mode === "recover") {
    return feature("error-recovery", () => {
      emit({ type: "error", tool: "lookup" });
      try {
        failTool();
      } catch {
        emit({ type: "recovery" });
        emitTool(emit, "lookup");
        return { output: `recovered:${lookup(task.goal)}`, feature: "error-recovery", recovered: true, steps: 2 };
      }
    });
  }
  if (task.mode === "lookup") {
    emitTool(emit, "lookup");
    return { output: lookup(task.goal), feature: "tool-routing", recovered: false, steps: 1 };
  }
  if (task.mode === "parse") {
    emitTool(emit, "parse");
    const parsed = parse(task.goal);
    return { output: parsed.tokens.join(","), feature: "tool-routing", recovered: false, steps: 1 };
  }
  if (task.mode === "compute") {
    emitTool(emit, "parse");
    emitTool(emit, "compute");
    const parsed = parse(task.goal);
    return { output: `count:${compute(parsed.tokens)}`, feature: "tool-routing", recovered: false, steps: 2 };
  }
  if (task.mode === "isolate") {
    emitTool(emit, "lookup");
    return { output: `isolated:${task.token ?? task.goal}`, feature: "tool-routing", recovered: false, token: task.token ?? task.goal, steps: 1 };
  }
  return feature("termination", () => ({ output: `planned:${task.goal}`, feature: "planning", recovered: false, token: task.token, steps: 0 }));
}

export async function runAgent(input: unknown, ctx?: { emit?: Emit }): Promise<AgentResult> {
  const emit: Emit = (event) => { ctx?.emit?.({ timestamp: new Date().toISOString(), ...event }); };
  const task = normalize(input);
  return feature("planning", () => {
    emit({ type: "plan", goal: task.goal, mode: task.mode });
    if (task.mode === "plan") return route(task, emit);
    return feature("tool-routing", () => route(task, emit));
  });
}
