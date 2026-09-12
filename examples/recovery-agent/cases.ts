import { defineCase, expect } from "../../packages/core/src/index.js";

export default defineCase({
  id: "agent-recovers-from-tool-error",
  tags: ["smoke"],
  input: "retry",
  expectedFeatures: ["error-recovery"],
  assertions: [
    expect.output().exists(),
    expect.trajectory().hasNoLoop(),
    expect.trajectory().maxSteps(12),
    expect.trajectory().errorRecovery(),
    expect.coverage().feature("error-recovery").atLeast(60),
  ],
});
