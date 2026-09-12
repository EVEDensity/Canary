import type { TestCase } from "../../../packages/core/src/index.js";

const cases: TestCase[] = [
  { id: "holdout-planning", input: "holdout plan", expectedFeatures: ["planning"], assertions: [{ type: "output.exists" }, { type: "execution.termination", expected: "completed" }] },
];

export default cases;
