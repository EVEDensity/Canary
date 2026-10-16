import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { CanaryMcpServer, LEGACY_PROTOCOL_VERSION } from "@canary/mcp-server";
import { FileArtifactRepository, verifyRepairTaskBundle } from "@canary/trace";
import { resolveProjectContext } from "../src/home.js";
import { bindPorts } from "../src/mcp.js";
import { runCommandDetailed } from "../src/index.js";

const roots: string[] = [];
afterEach(() => {
  const parent = realpathSync.native(tmpdir());
  for (const root of roots.splice(0)) {
    const path = relative(parent, root);
    if (!isAbsolute(root) || isAbsolute(path) || path === ".." || path.startsWith("..\\") || path.startsWith("../")) throw new Error("Unsafe repair task fixture cleanup root");
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
});

/** Proves the read tool neither executes project commands nor changes retained evidence/source. */
function projectHashes(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const file = join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) result[relative(root, file).replaceAll("\\", "/")] = createHash("sha256").update(readFileSync(file)).digest("hex");
      else throw new Error("Unexpected fixture entry");
    }
  };
  visit(root);
  return result;
}

it("returns a complete sealed repair task through MCP without executing or writing, and refuses corrupted source evidence", async () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "canary MCP repair task "))); roots.push(root);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "-q"); git("config", "user.name", "Canary fixture"); git("config", "user.email", "fixture@example.invalid"); git("config", "core.autocrlf", "false");
  writeFileSync(join(root, ".gitignore"), ".canary/\n");
  writeFileSync(join(root, "package.json"), '{"name":"mcp-repair-task-fixture","private":true,"type":"module"}\n');
  mkdirSync(join(root, "src")); mkdirSync(join(root, "tests"));
  writeFileSync(join(root, "src/invoice.mjs"), "export const total = () => 4;\n");
  writeFileSync(join(root, "tests/invoice.test.mjs"), "import assert from 'node:assert/strict';\nimport { total } from '../src/invoice.mjs';\nassert.equal(total(), 5, 'retained invoice assertion');\n");
  const configPath = join(root, "canary.project.json");
  writeFileSync(configPath, JSON.stringify({ kind: "canary.project", version: 1, checks: [
    { id: "build", type: "command", command: "node", args: ["--check", "src/invoice.mjs"] },
    { id: "invoice.test", type: "command", command: "node", args: ["tests/invoice.test.mjs"] },
  ] }));
  git("add", "."); git("commit", "-qm", "MCP task fixture");
  const run = await runCommandDetailed({ cwd: root, configPath, headless: true, noOpen: true, suppressOutput: true });
  try {
    expect(run.exitCode).toBe(1);
    const context = resolveProjectContext({ cwd: root }), repository = new FileArtifactRepository(context.artifactRoot);
    const before = projectHashes(root), manifest = repository.verify(run.runId).manifestHash;
    const server = new CanaryMcpServer({ token: "fixture", ports: bindPorts(context, {
      readRun() { throw new Error("Task builder must read the actual sealed run"); },
      async runHeadless() { throw new Error("Task read must not execute checks"); },
      async verify() { throw new Error("Task read must not execute verification"); },
    }) });
    await server.handleRequestAsync({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: LEGACY_PROTOCOL_VERSION, capabilities: {} } });
    server.handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" });
    const call = (args: object, id = 2) => server.handleRequestAsync({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "canary.repair_task", arguments: args } });
    const response = await call({ runId: run.runId, checks: ["invoice.test"], allowedPaths: ["src", "tests/invoice.test.mjs"] });
    expect(response?.error, JSON.stringify(response)).toBeUndefined();
    const bundle = (response?.result as { structuredContent: any }).structuredContent;
    expect(verifyRepairTaskBundle(bundle)).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(bundle))).toBeLessThanOrEqual(65_536);
    expect(bundle).toMatchObject({ kind: "canary.repair-task-bundle", task: { kind: "canary.repair-task", selectedChecks: ["invoice.test"], executionGranted: false, source: { runId: run.runId, manifestHash: manifest }, scope: { allowedPaths: ["src", "tests/invoice.test.mjs"], status: "declared" } } });
    expect(bundle.task.originalChecks.map((check: { id: string }) => check.id)).toEqual(["build", "invoice.test"]);
    expect(JSON.stringify(bundle)).toContain("retained invoice assertion");
    expect(bundle.task.commands.every((command: { intent: string; requiresExecutionGrant: boolean }) => command.intent === "inspect-reproduction" || command.requiresExecutionGrant === true)).toBe(true);
    expect(projectHashes(root)).toEqual(before);
    expect(repository.verify(run.runId).manifestHash).toBe(manifest);
    expect((await call({ runId: run.runId, checks: ["not-in-source-run"] }))?.error).toBeDefined();
    expect(projectHashes(root)).toEqual(before);
    const retainedFile = join(context.artifactRoot, run.runId, "run.json");
    writeFileSync(retainedFile, readFileSync(retainedFile, "utf8") + " ");
    expect(await call({ runId: run.runId })).toMatchObject({ error: { message: expect.stringMatching(/sealed|verified/i) } });
  } finally { await run.close(); }
}, 30_000);
