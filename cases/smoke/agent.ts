import { defineCases, expect } from "../../packages/core/src/index.js";

const outputObject = {
  safeParse: (value: unknown) => ({ success: typeof value === "object" && value !== null && "output" in (value as object) }),
};

export default defineCases([
  {
    id: "agent-planning",
    tags: ["smoke"],
    input: "plan a task",
    expectedFeatures: ["planning"],
    assertions: [
      expect.output().exists(),
      expect.coverage().feature("planning").expected(),
      expect.judge().score({ minScore: 0.5, minConfidence: 0.5, rubric: "Task has a planned output" }),
    ],
  },
  {
    id: "agent-lookup",
    tags: ["smoke"],
    input: { mode: "lookup", goal: "alpha" },
    expectedFeatures: ["tool-routing"],
    assertions: [
      expect.trajectory().requiredEvent("tool.call"),
      expect.tool().called("lookup"),
      expect.tool().args("lookup", { contains: { q: "alpha" } }),
      expect.state().has("lastTool"),
      expect.output().predicate((value) => String((value as { output?: string }).output ?? "").includes("found:alpha")),
    ],
  },
  {
    id: "agent-parse",
    tags: ["smoke"],
    input: { mode: "parse", goal: "one two" },
    expectedFeatures: ["tool-routing"],
    assertions: [
      expect.trajectory().requiredEvent("tool.call"),
      expect.output().predicate((value) => String((value as { output?: string }).output ?? "") === "one,two"),
    ],
  },
  {
    id: "agent-compute",
    tags: ["smoke"],
    input: { mode: "compute", goal: "a b c" },
    expectedFeatures: ["tool-routing"],
    assertions: [
      expect.trajectory().maxToolCalls(4),
      expect.tool().order(["parse", "compute"]),
      expect.output().predicate((value) => String((value as { output?: string }).output ?? "") === "count:3"),
    ],
  },
  {
    id: "agent-tool-failure-recovery",
    tags: ["smoke"],
    input: { mode: "recover", goal: "retry" },
    expectedFeatures: ["error-recovery"],
    assertions: [
      expect.trajectory().errorRecovery(),
      expect.coverage().feature("error-recovery").expected(),
    ],
  },
  {
    id: "agent-loop-stop",
    tags: ["smoke"],
    input: { mode: "loop" },
    expectedFeatures: ["termination"],
    assertions: [
      expect.trajectory().requiredEvent("loop_detected"),
      expect.trajectory().maxToolCalls(4),
    ],
  },
  {
    id: "agent-forbidden-tool",
    tags: ["smoke"],
    input: { mode: "lookup", goal: "safe" },
    assertions: [
      expect.trajectory().forbiddenEvent("dangerous_tool"),
      expect.policy().none(),
    ],
  },
  {
    id: "agent-max-steps",
    tags: ["smoke"],
    input: { mode: "compute", goal: "keep bounds" },
    assertions: [expect.trajectory().maxSteps(8)],
  },
  {
    id: "agent-termination-completed",
    tags: ["smoke"],
    input: "finish cleanly",
    assertions: [expect.execution().termination("completed")],
  },
  {
    id: "agent-context-isolation-a",
    tags: ["smoke"],
    input: { mode: "isolate", token: "alpha" },
    assertions: [
      expect.output().predicate((value) => {
        const output = String((value as { output?: string }).output ?? "");
        return output.includes("alpha") && !output.includes("beta");
      }),
    ],
  },
  {
    id: "agent-context-isolation-b",
    tags: ["smoke"],
    input: { mode: "isolate", token: "beta" },
    assertions: [
      expect.output().predicate((value) => {
        const output = String((value as { output?: string }).output ?? "");
        return output.includes("beta") && !output.includes("alpha");
      }),
    ],
  },
  {
    id: "agent-output-schema",
    tags: ["smoke"],
    input: { mode: "plan", goal: "schema" },
    assertions: [expect.output().schema(outputObject)],
  },
  {
    id: "agent-feature-routing",
    tags: ["smoke"],
    input: { mode: "lookup", goal: "route" },
    expectedFeatures: ["tool-routing"],
    assertions: [expect.feature("tool-routing")],
  },
]);
