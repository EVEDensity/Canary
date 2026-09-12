import { describe, expect, it } from "vitest";
import { benchmarkCoverageSummarize } from "../src/index.js";

describe("coverage sampling benchmark", () => {
  it("reports summarizeCoverage throughput in ops/sec", () => {
    const result = benchmarkCoverageSummarize(120);
    expect(result.iterations).toBe(120);
    expect(result.elapsedMs).toBeGreaterThan(0);
    expect(result.opsPerSec).toBeGreaterThan(20);
  });
});
