import { describe, expect, it } from "vitest";
import { DiagnosticOutput } from "../src/diagnostic-output.js";

describe("bounded diagnostic evidence", () => {
  it("retains an early error and late stack after more than 64 KiB of noise", () => {
    const capture = new DiagnosticOutput({});
    capture.append("Error: early failure\n at early.ts:12:3\n");
    for (let i = 0; i < 3000; i++) capture.append(`progress ${i} ${".".repeat(80)}\n`);
    capture.append("Error: final failure\n at src/example.ts:42:8\n");
    const result = capture.finish();
    expect(result.lines.join("\n")).toContain("early.ts:12:3");
    expect(result.summary).toContain("src/example.ts:42:8");
    expect(result.lines.join("\n").length).toBeLessThan(65_000);
    expect(result.truncated).toBe(true);
  });
  it("redacts split chunks, private key blocks, assignments and oversized credentials before retaining excerpts", () => {
    const capture = new DiagnosticOutput({ TEST_TOKEN: "known-env-credential" });
    const chunks = [
      "Error: Bear",
      "er opaque-bearer-value\n",
      "known-env-",
      "credential\n",
      "-----BEGIN PRIVATE KEY-----\nprivate-key-body\n-----END PRIVATE KEY-----\n",
      "password=\ncontinuation-secret\n",
      "token=" + "a".repeat(70_000),
      "\nError: src/last.ts:9:1\n",
    ];
    chunks.forEach((chunk) => capture.append(chunk));
    const result = capture.finish(),
      output = JSON.stringify(result);
    for (const secret of [
      "opaque-bearer-value",
      "known-env-credential",
      "private-key-body",
      "continuation-secret",
      "a".repeat(100),
    ])
      expect(output).not.toContain(secret);
    expect(output).toContain("src/last.ts:9:1");
    expect(output).toContain("redacted");
    expect(result.truncated).toBe(true);
  });
  it("omits an unfinished oversized line without returning a credential fragment", () => {
    const capture = new DiagnosticOutput({});
    capture.append("Bearer " + "x".repeat(80_000));
    expect(capture.finish().lines.join("\n")).toContain("[oversized line omitted]");
  });
});
