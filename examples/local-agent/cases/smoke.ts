import type { TestCase } from "../../../packages/core/src/index.js";

const cases: TestCase[] = [
  { id: "agent-planning", input: "plan a task", expectedFeatures: ["planning"], assertions: [{ type: "output.exists" }] },
];
export default cases;
