import type { TestCase } from "../../../packages/core/src/index.js";

const outputObject = {
  safeParse: (value: unknown) => ({ success: typeof value === "object" && value !== null && "output" in (value as object) }),
};

const cases: TestCase[] = [
  { id: "agent-planning", input: "plan a task", expectedFeatures: ["planning"], assertions: [{ type: "output.exists" }, { type: "feature.expected", featureId: "planning" }] },
  { id: "agent-lookup", input: { mode: "lookup", goal: "alpha" }, expectedFeatures: ["tool-routing"], assertions: [{ type: "trajectory.required_event", event: "tool.call" }, { type: "output.predicate", predicate: (value) => String((value as { output?: string }).output ?? "").includes("found:alpha") }] },
  { id: "agent-parse", input: { mode: "parse", goal: "one two" }, expectedFeatures: ["tool-routing"], assertions: [{ type: "trajectory.required_event", event: "tool.call" }, { type: "output.predicate", predicate: (value) => String((value as { output?: string }).output ?? "") === "one,two" }] },
  { id: "agent-compute", input: { mode: "compute", goal: "a b c" }, expectedFeatures: ["tool-routing"], assertions: [{ type: "trajectory.max_tool_calls", max: 4 }, { type: "output.predicate", predicate: (value) => String((value as { output?: string }).output ?? "") === "count:3" }] },
  { id: "agent-tool-failure-recovery", input: { mode: "recover", goal: "retry" }, expectedFeatures: ["error-recovery"], assertions: [{ type: "trajectory.error_recovery" }, { type: "feature.expected", featureId: "error-recovery" }] },
  { id: "agent-loop-stop", input: { mode: "loop" }, expectedFeatures: ["termination"], assertions: [{ type: "trajectory.required_event", event: "loop_detected" }, { type: "trajectory.max_tool_calls", max: 4 }] },
  { id: "agent-forbidden-tool", input: { mode: "lookup", goal: "safe" }, assertions: [{ type: "trajectory.forbidden_event", event: "dangerous_tool" }] },
  { id: "agent-max-steps", input: { mode: "compute", goal: "keep bounds" }, assertions: [{ type: "trajectory.max_steps", max: 8 }] },
  { id: "agent-termination-completed", input: "finish cleanly", assertions: [{ type: "execution.termination", expected: "completed" }] },
  { id: "agent-context-isolation-a", input: { mode: "isolate", token: "alpha" }, assertions: [{ type: "output.predicate", predicate: (value) => { const output = String((value as { output?: string }).output ?? ""); return output.includes("alpha") && !output.includes("beta"); } }] },
  { id: "agent-context-isolation-b", input: { mode: "isolate", token: "beta" }, assertions: [{ type: "output.predicate", predicate: (value) => { const output = String((value as { output?: string }).output ?? ""); return output.includes("beta") && !output.includes("alpha"); } }] },
  { id: "agent-output-schema", input: { mode: "plan", goal: "schema" }, assertions: [{ type: "output.schema", schema: outputObject }] },
  { id: "agent-feature-routing", input: { mode: "lookup", goal: "route" }, expectedFeatures: ["tool-routing"], assertions: [{ type: "feature.expected", featureId: "tool-routing" }] },
];

export default cases;
