import { defineCase, expect } from "../../packages/core/src/index.js";

export default defineCase({
  id: "http-echo",
  input: { goal: "remote-task" },
  assertions: [
    expect.output().exists(),
    expect.output().predicate((value) => Boolean(value && typeof value === "object" && "remote" in value && (value as { remote?: boolean }).remote)),
    expect.trajectory().requiredEvent("http.request"),
  ],
});
