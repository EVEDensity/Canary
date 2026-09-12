import { defineCase, expect } from "../../packages/core/src/index.js";

export default defineCase({
  id: "holdout-planning",
  tags: ["holdout"],
  input: "holdout plan",
  expectedFeatures: ["planning"],
  assertions: [
    expect.output().exists(),
    expect.execution().termination("completed"),
  ],
});
