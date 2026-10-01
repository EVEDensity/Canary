import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beginArtifacts, sealArtifacts, writePrivateJson, verifyDiagnosticBundle } from "@canary/trace";
import { main } from "../src/index.js";

describe("diagnostic CLI", () => {
  it("exports and verifies sealed evidence and refuses overwrite, corruption and invalid arguments", async () => {
    const root = mkdtempSync(join(tmpdir(), "canary-diagnostic-cli-"));
    const config = join(root, "canary.config.ts");
    writeFileSync(config, "export default {};\n");
    const dir = join(root, ".canary", "artifacts", "run_diag");
    beginArtifacts(dir);
    writePrivateJson(join(dir, "run.json"), { runId: "run_diag", status: "failed", startedAt: "2026-10-01T00:00:00Z", totalCases: 1, completedCases: 1, passedCases: 0, results: [], events: [], checks: [{ id: "test", type: "command", status: "failed", category: "assertion", cwd: root, envAllowlist: [], stderr: "AssertionError: password=superprivate" }] });
    sealArtifacts(dir);
    const output = join(root, "diagnostics.json");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await main(["diagnostics", "run_diag", "--config", config])).toBe(0);
      const diagnostic = JSON.parse(String(log.mock.calls.at(-1)![0]));
      expect(diagnostic.kind).toBe("canary.diagnostics");
      expect(await main(["diagnostics", "run_diag", "--config", config, "--out", output])).toBe(0);
      const bundle = JSON.parse(readFileSync(output, "utf8"));
      expect(bundle.files["diagnostics.json"]).toEqual(diagnostic);
      expect(verifyDiagnosticBundle(bundle)).toBe(true);
      expect(readFileSync(output, "utf8")).not.toContain("superprivate");
      expect(await main(["diagnostics", "verify", output])).toBe(0);
      expect(await main(["diagnostics", "run_diag", "--config", config, "--out", output])).toBe(1);
      expect(await main(["diagnostics", "run_diag", "--config", config, "--bad"])).toBe(1);
      bundle.files["NEXT-STEPS.txt"] += "changed";
      writeFileSync(output, JSON.stringify(bundle));
      expect(await main(["diagnostics", "verify", output])).toBe(1);
      writeFileSync(join(dir, "run.json"), "{}");
      expect(await main(["diagnostics", "run_diag", "--config", config])).toBe(1);
    } finally { log.mockRestore(); error.mockRestore(); }
  });
});
