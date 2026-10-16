import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { CanaryMcpServer, LEGACY_PROTOCOL_VERSION } from "@canary/mcp-server";
import { FileArtifactRepository } from "@canary/trace";
import { resolveProjectContext } from "../src/home.js";
import { bindPorts } from "../src/mcp.js";
import { runCommandDetailed } from "../src/index.js";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../src/project-memory.js", async importOriginal => ({ ...await importOriginal<typeof import("../src/project-memory.js")>(), queryProjectMemory: query }));
const roots: string[] = [];
afterEach(() => {
  query.mockReset();
  const parent = realpathSync.native(tmpdir());
  for (const root of roots.splice(0)) {
    const path = relative(parent, root);
    if (!isAbsolute(root) || isAbsolute(path) || path === ".." || path.startsWith("..\\") || path.startsWith("../")) throw new Error("Unsafe memory fixture cleanup root");
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
});
function directory() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "canary MCP memory ")));
  roots.push(root);
  return root;
}
function hashes(root: string): Record<string, string> {
  const output: Record<string, string> = {};
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const file = join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) output[relative(root, file).replaceAll("\\", "/")] = createHash("sha256").update(readFileSync(file)).digest("hex");
      else throw new Error("Unexpected memory fixture entry");
    }
  };
  visit(root);
  return output;
}
async function serverFor(root: string) {
  const context = resolveProjectContext({ cwd: root });
  const server = new CanaryMcpServer({ token: "fixture", ports: bindPorts(context, {
    readRun() { throw new Error("Memory query must read its actual sealed evidence"); },
    async runHeadless() { throw new Error("Memory query must not execute checks"); },
    async verify() { throw new Error("Memory query must not execute verification"); },
  }) });
  await server.handleRequestAsync({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: LEGACY_PROTOCOL_VERSION, capabilities: {} } });
  server.handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" });
  let id = 1;
  return { context, call: (args: object) => server.handleRequestAsync({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name: "canary.memory", arguments: args } }) };
}

it("binds memory reads to the selected project and preserves a complete bounded report", async () => {
  const root = directory();
  writeFileSync(join(root, "package.json"), '{"name":"memory-port-fixture","private":true}');
  const bound = await serverFor(root), before = hashes(root);
  const report = { v: 1, kind: "canary.project-memory-query", status: "available", items: [{ manifestHash: "a".repeat(64), reason: "related history ".repeat(180) }], advisoryOnly: true, executionGranted: false };
  query.mockReturnValue(report);
  const response = await bound.call({ runId: "run_failed", checks: ["test"], maxItems: 2, maxChars: 4096 });
  expect(response?.error, JSON.stringify(response)).toBeUndefined();
  expect((response?.result as { structuredContent: unknown }).structuredContent).toEqual(report);
  expect(query).toHaveBeenCalledExactlyOnceWith(bound.context, { runId: "run_failed", checks: ["test"], maxItems: 2, maxChars: 4096 });
  expect(hashes(root)).toEqual(before);
  expect((await bound.call({ runId: "run_failed", project: "/another", token: "raise-permission" }))?.error).toBeDefined();
  expect(query).toHaveBeenCalledTimes(1);
  query.mockReturnValue({ ...report, items: [{ reason: "中".repeat(30_000) }] });
  expect((await bound.call({ runId: "run_failed" }))?.error?.message).toMatch(/bounded response size/i);
  expect(hashes(root)).toEqual(before);
});

it("queries actual sealed failures without creating memory state, and cannot read a different project's run", async () => {
  const actual = await vi.importActual<typeof import("../src/project-memory.js")>("../src/project-memory.js");
  query.mockImplementation(actual.queryProjectMemory);
  const root = directory(), other = directory();
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "-q"); git("config", "user.name", "Canary fixture"); git("config", "user.email", "fixture@example.invalid"); git("config", "core.autocrlf", "false");
  writeFileSync(join(root, ".gitignore"), ".canary/\n");
  writeFileSync(join(root, "package.json"), '{"name":"memory-read-fixture","private":true,"type":"module"}\n');
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src/check.mjs"), "throw new Error('retained failed check');\n");
  const configPath = join(root, "canary.project.json");
  writeFileSync(configPath, JSON.stringify({ kind: "canary.project", version: 1, checks: [{ id: "test", type: "command", command: "node", args: ["src/check.mjs"] }] }));
  git("add", "."); git("commit", "-qm", "Retained failure fixture");
  writeFileSync(join(other, "package.json"), '{"name":"different-project","private":true}');
  const execution = await runCommandDetailed({ cwd: root, configPath, headless: true, noOpen: true, suppressOutput: true });
  try {
    expect(execution.exitCode).toBe(1);
    const bound = await serverFor(root), foreign = await serverFor(other), before = hashes(root), otherBefore = hashes(other);
    const repository = new FileArtifactRepository(bound.context.artifactRoot), manifest = repository.verify(execution.runId).manifestHash;
    const result = await bound.call({ runId: execution.runId, checks: ["test"], maxItems: 1, maxChars: 512 });
    expect(result?.error, JSON.stringify(result)).toBeUndefined();
    const report = (result?.result as { structuredContent: any }).structuredContent;
    expect(report).toMatchObject({ kind: "canary.project-memory-query", advisoryOnly: true, executionGranted: false, items: [] });
    expect(Buffer.byteLength(JSON.stringify(report))).toBeLessThanOrEqual(65_536);
    const unavailable = await foreign.call({ runId: execution.runId });
    expect(unavailable?.error, JSON.stringify(unavailable)).toBeUndefined();
    expect((unavailable?.result as { structuredContent: unknown }).structuredContent).toMatchObject({ status: "unavailable", items: [], advisoryOnly: true, executionGranted: false });
    expect(hashes(root)).toEqual(before);
    expect(hashes(other)).toEqual(otherBefore);
    expect(repository.verify(execution.runId).manifestHash).toBe(manifest);
  } finally { await execution.close(); }
}, 30_000);
