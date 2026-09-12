import { defineCases, expect } from "../../packages/core/src/index.js";

export default defineCases([
  {
    id: "loop-stop",
    tags: ["smoke"],
    input: "spin",
    assertions: [
      expect.trajectory().requiredEvent("loop_detected"),
      expect.trajectory().maxToolCalls(4),
      expect.output().exists(),
    ],
  },
  {
    id: "loop-clean",
    tags: ["smoke"],
    input: "ok",
    assertions: [
      expect.trajectory().hasNoLoop(),
      expect.output().exists(),
    ],
  },
]);
