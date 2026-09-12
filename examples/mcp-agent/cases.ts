import { defineCase, expect } from "../../packages/core/src/index.js";

export default defineCase({
  id: "mcp-echo",
  tags: ["smoke"],
  input: { goal: "remote-mcp" },
  assertions: [
    expect.output().exists(),
    expect.output().predicate((value) => Boolean(value && typeof value === "object" && String((value as { output?: string }).output ?? "").includes("mcp:remote-mcp"))),
    expect.trajectory().requiredEvent("mcp.request"),
  ],
});
