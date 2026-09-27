import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeCi } from "../src/ci.js";
import { main, runCommandDetailed } from "../src/index.js";
import { FileArtifactRepository } from "@canary/trace";
import type { CiSelectionPlan, ArchitectureAnalysis, ChangeImpact } from "@canary/structure";

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "canary-r15-")); roots.push(root);
  const configPath = join(root, "checks.json");
  writeFileSync(join(root, "package.json"), '{"type":"module"}');
  writeFileSync(join(root, "math.js"), "export const value = 1;\n");
  writeFileSync(join(root, "app.js"), "import { value } from './math.js';\nif(value!==2) throw Error('wrong result');\n");
  writeFileSync(join(root, "other.js"), "console.log('unrelated');\n");
  writeFileSync(configPath, JSON.stringify({ kind: "canary.project", version: 1, checks: [
    { id: "prep", type: "command", command: process.execPath, args: ["-e", "console.log('prepare')"], impact: { paths: ["other.js"] } },
    { id: "app", type: "command", command: process.execPath, args: ["app.js"], dependsOn: ["prep"], impact: { paths: ["app.js"] } },
    { id: "other", type: "command", command: process.execPath, args: ["other.js"], impact: { paths: ["other.js"] } },
  ] }));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, windowsHide: true, stdio: "ignore" });
  git("init", "-q"); git("add", "."); git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "baseline");
  writeFileSync(join(root, "math.js"), "export const value = 2;\n");
  return { root, configPath };
}
describe("R15 incremental project CI", () => {
  it("executes consumers and dependencies, seals reasons and preserves historical analysis", async () => {
    const { root, configPath } = fixture();
    const args = ["--ci", "--config", configPath, "--base", "HEAD"];
    const full = await executeCi(args, runCommandDetailed), incremental = await executeCi([...args, "--affected"], runCommandDetailed);
    expect(full.exitCode).toBe(0); expect(full.summary.total).toBe(3);
    expect(incremental.exitCode).toBe(0); expect(incremental.summary.total).toBe(2);
    expect(incremental.selection).toMatchObject({ mode: "reduced", planned: 3, selected: 2, omitted: 1 });
    const repository = new FileArtifactRepository(join(root, ".canary/artifacts")), runId = incremental.runId!;
    expect(repository.verify(runId).status).toBe("verified");
    const plan = repository.readJson<CiSelectionPlan>(runId, "ci-plan.json")!;
    expect(plan.checks.find((check) => check.id === "other")?.action).toBe("omit");
    expect(repository.readRun(runId)?.checkSelection?.omittedChecks).toEqual([{ id: "other", reason: "declared-scope-unaffected" }]);
    expect(repository.readJson<{ selection: { mode: string } }>(runId, "report.json")?.selection.mode).toBe("reduced");
    expect(repository.readJson<ArchitectureAnalysis>(runId, "architecture-analysis.json")?.kind).toBe("canary.architecture-analysis");
    const impact = repository.readJson<ChangeImpact>(runId, "change-impact.json")!;
    expect(impact.affected.some((node) => node.path === "app.js")).toBe(true);
    writeFileSync(join(root, "math.js"), "export const value = 3;\n");
    const printed = vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(await main(["impact", "--run", runId, "--config", configPath])).toBe(0);
    expect(JSON.parse(String(printed.mock.calls.at(-1)![0])).impact.source.inventoryHash).toBe(impact.source.inventoryHash);
    const failure = await executeCi([...args, "--affected"], runCommandDetailed);
    expect(failure.exitCode).toBe(1); expect(failure.summary.failed).toBe(1);
    expect((await executeCi(["--ci", "--config", configPath, "--affected"], runCommandDetailed)).exitCode).toBe(2);
  });
});
