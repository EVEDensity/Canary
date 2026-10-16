import { describe, expect, it, vi } from "vitest";
import { CanaryMcpServer, LEGACY_PROTOCOL_VERSION, parseMemoryArgs, toolList, type CanaryMcpPorts } from "../src/index.js";

const ports = (memory?: CanaryMcpPorts["memory"]): CanaryMcpPorts => ({
  projectRoot: "/bound/project",
  run: vi.fn(async () => { throw new Error("Memory must not execute checks"); }),
  evidence: vi.fn(),
  structure: vi.fn(),
  submitProposal: vi.fn(() => { throw new Error("Memory must not record proposals"); }),
  memory,
});

describe("read-only project memory MCP surface", () => {
  it("declares bounded read-only input and no recording, revocation or project override", () => {
    const tool = toolList().tools.find(item => item.name === "canary.memory")!;
    expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    expect(tool.inputSchema.additionalProperties).toBe(false);
    expect(tool.inputSchema.required).toEqual(["runId"]);
    expect(Object.keys(tool.inputSchema.properties).sort()).toEqual(["checks", "maxChars", "maxItems", "runId"]);
    expect(tool.description).toMatch(/historical verification does not verify this failure/i);
    expect(parseMemoryArgs({ runId: "run_failure" })).toEqual({ runId: "run_failure" });
    expect(parseMemoryArgs({ runId: "run_failure", checks: ["workspace.test"], maxItems: 10, maxChars: 32768 })).toEqual({ runId: "run_failure", checks: ["workspace.test"], maxItems: 10, maxChars: 32768 });
    expect(parseMemoryArgs({ runId: "run_failure", maxItems: 1, maxChars: 512 })).toEqual({ runId: "run_failure", maxItems: 1, maxChars: 512 });
  });

  it("rejects malformed identities, duplicate scopes, invalid budgets and permission escalation", () => {
    for (const input of [
      {}, null, [], { runId: "../other" }, { runId: "run\nother" }, { runId: " run_failure " },
      { runId: "run_failure", checks: [] }, { runId: "run_failure", checks: ["test", "test"] },
      { runId: "run_failure", checks: ["../test"] }, { runId: "run_failure", checks: Array.from({ length: 17 }, (_, n) => `check-${n}`) },
      ...[0, 11, 1.5, "2", null, NaN, Infinity].map(maxItems => ({ runId: "run_failure", maxItems })),
      ...[511, 32769, 1000.5, "8000", null, NaN, Infinity].map(maxChars => ({ runId: "run_failure", maxChars })),
      ...["project", "projectRoot", "cwd", "file", "allowedPaths", "write", "activate", "action", "token", "authorization", "password"].map(key => ({ runId: "run_failure", [key]: "/another/project" })),
    ]) expect(() => parseMemoryArgs(input), JSON.stringify(input)).toThrow();
  });

  it("dispatches only to the read port and preserves complete returned identities", async () => {
    const report = { kind: "canary.project-memory-query", status: "available", advisoryOnly: true, executionGranted: false, items: [{ content: "related evidence ".repeat(180), manifestHash: "a".repeat(64) }] };
    const memory = vi.fn(() => report), binding = ports(memory), server = new CanaryMcpServer({ token: "fixture", ports: binding });
    await server.handleRequestAsync({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: LEGACY_PROTOCOL_VERSION, capabilities: {} } });
    server.handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" });
    const result = await server.handleRequestAsync({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "canary.memory", arguments: { runId: "run_failure", checks: ["test"], maxChars: 8000 } } });
    expect(result?.error).toBeUndefined();
    expect((result?.result as { structuredContent: unknown }).structuredContent).toEqual(report);
    expect(memory).toHaveBeenCalledExactlyOnceWith({ runId: "run_failure", checks: ["test"], maxChars: 8000 });
    expect(binding.run).not.toHaveBeenCalled();
    expect(binding.submitProposal).not.toHaveBeenCalled();
    const invalid = await server.handleRequestAsync({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "canary.memory", arguments: { runId: "run_failure", action: "record" } } });
    expect(invalid?.error).toBeDefined();
    expect(memory).toHaveBeenCalledTimes(1);
  });

  it("reports a missing binding explicitly instead of executing an alternative tool", async () => {
    const server = new CanaryMcpServer({ token: "fixture", ports: ports() });
    await server.handleRequestAsync({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: LEGACY_PROTOCOL_VERSION, capabilities: {} } });
    server.handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" });
    const result = await server.handleRequestAsync({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "canary.memory", arguments: { runId: "run_failure" } } });
    expect(result?.error?.message).toMatch(/memory is unavailable/i);
  });
});
