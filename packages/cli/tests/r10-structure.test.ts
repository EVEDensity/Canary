import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileArtifactRepository } from "@canary/trace";
import type { StructureSnapshot, StructureChange } from "@canary/structure";
import { executeCi } from "../src/ci.js";
import { main, runCommandDetailed } from "../src/index.js";
import { bindPorts } from "../src/mcp.js";
import { resolveProjectContext } from "../src/home.js";

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("R10 sealed structure across CI and CLI", () => {
  it("reports invalid architecture rules as a configuration preflight error", async () => {
    const root = mkdtempSync(join(tmpdir(), "canary-r10-invalid-")); roots.push(root);
    const config = join(root, "canary.project.json");
    writeFileSync(config, JSON.stringify({ kind: "canary.project", version: 1, checks: [{ id: "smoke", type: "command", command: "node", args: ["-e", "process.exit(0)"] }] }));
    writeFileSync(join(root, "canary.architecture.json"), JSON.stringify({ v: 1, layers: [{ id: "bad", name: "bad", paths: ["../outside/**"] }] }));
    const ci = await executeCi(["--ci", "--config", config], runCommandDetailed);
    expect(ci.exitCode).toBe(2);
    expect(ci.issues).toContainEqual(expect.objectContaining({ code: "STRUCTURE_PREFLIGHT_BLOCKED" }));
  });

  it("pins a Git change snapshot to the run and rejects damaged historical evidence", async () => {
    const root = mkdtempSync(join(tmpdir(), "canary-r10-run-")); roots.push(root);
    const config = join(root, "canary.project.json");
    const source = join(root, "main.ts");
    writeFileSync(config, JSON.stringify({ kind: "canary.project", version: 1, checks: [{ id: "smoke", type: "command", command: "node", args: ["-e", "process.exit(0)"] }] }));
    writeFileSync(source, "export function answer() { return 1; }\n");
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, windowsHide: true, stdio: "ignore" });
    git("init", "-q"); git("add", "."); git("-c", "user.name=Canary Test", "-c", "user.email=test@example.com", "commit", "-qm", "baseline");
    writeFileSync(source, "export function answer() { return 2; }\n");
    const ci = await executeCi(["--ci", "--config", config, "--base", "HEAD"], runCommandDetailed);
    expect(ci.exitCode).toBe(0);
    const runId = ci.runId!;
    const repository = new FileArtifactRepository(join(root, ".canary", "artifacts"));
    expect(repository.verify(runId).status).toBe("verified");
    const saved = repository.readJson<StructureSnapshot>(runId, "structure.json")!;
    const change = repository.readJson<StructureChange>(runId, "structure-change.json")!;
    const oldHash = saved.nodes.find((node) => node.kind === "file" && node.path === "main.ts")?.sourceHash;
    expect(change.entries).toContainEqual(expect.objectContaining({ status: "modified", path: "main.ts" }));
    expect(change.current.runId).toBe(runId);
    expect(saved.source.gitCommit).toMatch(/^[a-f0-9]{40}$/);
    expect(saved.source.runId).toBe(runId);
    writeFileSync(source, "export function answer() { return 3; }\n");
    const printed = vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(await main(["structure", "--run", runId, "--config", config])).toBe(0);
    const historical = JSON.parse(String(printed.mock.calls.at(-1)?.[0])) as { structure: StructureSnapshot };
    expect(historical.structure.nodes.find((node) => node.path === "main.ts" && node.kind === "file")?.sourceHash).toBe(oldHash);
    const aiPort = bindPorts(resolveProjectContext({ configPath: config }), { readRun: () => undefined, runHeadless: async () => undefined });
    const aiPage = aiPort.structure({ runId, pathPrefix: "main.ts", offset: 0, maxNodes: 10 }) as { nodes: StructureSnapshot["nodes"]; manifestHash: string };
    expect(aiPage.nodes.find((node) => node.kind === "file")?.sourceHash).toBe(oldHash);
    expect(aiPage.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(readFileSync(source, "utf8")).toContain("return 3");
    writeFileSync(join(root, ".canary", "artifacts", runId, "structure.json"), "{damaged");
    expect(repository.verify(runId).status).toBe("invalid");
    expect(await main(["structure", "--run", runId, "--config", config])).toBe(2);
    expect(() => aiPort.structure({ runId })).toThrow(/sealed evidence/);
  }, 20_000);
});
