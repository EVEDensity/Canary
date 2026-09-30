import { defineCase, expect } from "../../../../packages/core/src/index.js";

export default defineCase({
  id: "regression-lookup-alpha",
  tags: ["regression"],
  dataset: { split: "regression", version: "demo-v1" },
  input: { mode: "lookup", goal: "alpha" },
  expectedFeatures: ["tool-routing"],
  assertions: [
    expect.tool().called("lookup"),
    expect.tool().args("lookup", { contains: { q: "alpha" } }),
    expect.output().predicate((value) => String((value as { output?: string }).output ?? "").includes("found:alpha")),
  ],
});
