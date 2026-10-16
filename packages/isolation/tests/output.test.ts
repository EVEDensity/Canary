import { describe, expect, it } from "vitest";
import { BoundedExecutionOutput } from "../src/index.js";

describe("shared execution byte capture", () => {
  it("keeps first error and final stack while bounding both streams together", () => {
    const capture = new BoundedExecutionOutput(8192);
    capture.append("stdout", "initial output\n" + "noise\n".repeat(1000));
    capture.append("stderr", "Error: first assertion\n    at initial (test.js:1:1)\n");
    for (let index = 0; index < 100; index++) capture.append("stdout", Buffer.alloc(65536, "n"));
    capture.append("stderr", "Error: final assertion\n    at final (test.js:99:1)\n");
    const result = capture.finish();
    expect(result.truncated).toBe(true);
    expect(result.observedBytes).toBeGreaterThan(6_000_000);
    expect(result.retainedBytes).toBeLessThanOrEqual(8192);
    expect(result.retainedBytes).toBe(Buffer.byteLength(result.stdout + result.stderr));
    expect(result.stderr).toContain("Error: first assertion");
    expect(result.stderr).toContain("at final (test.js:99:1)");
  });
  it("counts UTF-8 bytes and bounds an oversized line without newline", () => {
    const capture = new BoundedExecutionOutput(1024);
    capture.append("stdout", "中".repeat(300));
    capture.append("stderr", "文".repeat(300));
    const result = capture.finish();
    expect(result.observedBytes).toBe(1800);
    expect(result.truncated).toBe(true);
    expect(result.retainedBytes).toBeLessThanOrEqual(1024);
  });
  it("retains small output unchanged", () => {
    const capture = new BoundedExecutionOutput(1024);
    capture.append("stdout", "hello\n"); capture.append("stderr", "warning\n");
    expect(capture.finish()).toEqual({ maxBytes: 1024, observedBytes: 14, retainedBytes: 14, truncated: false, stdout: "hello\n", stderr: "warning\n" });
  });
  it("reports truncation when invalid byte sequences expand during UTF-8 decoding", () => {
    const capture = new BoundedExecutionOutput(1024);
    capture.append("stderr", Buffer.alloc(400, 255));
    expect(capture.finish()).toMatchObject({ truncated: true, observedBytes: 400, retainedBytes: 1023 });
  });
});
