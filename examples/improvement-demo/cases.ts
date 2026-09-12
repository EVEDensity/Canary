import { defineCases, expect } from "../../packages/core/src/index.js";

export default defineCases([
  { id: "safe", tags: ["smoke"], input: "ok", assertions: [expect.output().exists()] },
  { id: "broken", tags: ["regression"], input: "broken", assertions: [expect.output().exists()] },
  { id: "holdout-planning", tags: ["holdout"], input: "holdout", assertions: [expect.output().exists()] },
]);
