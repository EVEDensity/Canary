import { describe, expect, it } from "vitest";
import { emptyCoverage, metric } from "../src/index.js";

describe("coverage fixture contract", () => {
  it("represents unavailable coverage explicitly", () => {
    const summary = emptyCoverage("run_1", "hash");
    expect(summary.status).toBe("unavailable");
    expect(summary.lines.pct).toBe(0);
  });

  it("does not exceed one hundred percent", () => {
    expect(metric(4, 2).pct).toBe(200);
  });
});
