import { describe, expect, it } from "vitest";
import { V8CoverageCollector } from "../src/index.js";

describe("V8CoverageCollector", () => {
  it("is idempotent on repeated stop", async () => {
    const collector = new V8CoverageCollector({ runId: "run_stop", executionId: "exec_stop", include: ["**/*.ts"] });
    const first = await collector.stop();
    const second = await collector.stop();
    expect(second).toEqual(first);
  });
});
