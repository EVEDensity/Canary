import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  CLIENT_CAPABILITIES_KEY,
  COMPATIBILITY_MATRIX,
  CanaryMcpServer,
  LEGACY_PROTOCOL_VERSION,
  MODERN_PROTOCOL_VERSION,
  PROTOCOL_VERSION_KEY,
  REQUEST_CANCELLED,
  UNSUPPORTED_PROTOCOL_VERSION,
  serveStdio,
  type CanaryMcpPorts,
} from "../src/index.js";

function modernMeta(version = MODERN_PROTOCOL_VERSION) {
  return {
    [PROTOCOL_VERSION_KEY]: version,
    [CLIENT_CAPABILITIES_KEY]: {},
    "io.modelcontextprotocol/clientInfo": { name: "canary-test-client", version: "0.1.0" },
  };
}

function ports(overrides: Partial<CanaryMcpPorts> = {}): CanaryMcpPorts {
  return {
    projectRoot: "/bound/project",
    async run(input, signal) {
      if (signal.aborted) throw new Error("aborted");
      return { kind: "canary.host.run", runId: "run_1", caseId: input.caseId, projectRoot: "/bound/project" };
    },
    evidence(input) {
      return { kind: "canary.host.evidence", untrustedEvidence: true, runId: input.runId };
    },
    structure(input) {
      return { kind: "canary.host.structure", runId: input.runId, page: { offset: input.offset, maxNodes: input.maxNodes } };
    },
    submitProposal(input) {
      return { kind: "canary.host.proposal-validation", status: "recorded_unapproved", approval: { status: "not_approved" }, proposal: input.proposal };
    },
    ...overrides,
  };
}

describe("S-02 compatibility matrix and dual-era protocol", () => {
  it("documents the fixed support matrix", () => {
    expect(COMPATIBILITY_MATRIX.protocols).toEqual([MODERN_PROTOCOL_VERSION, LEGACY_PROTOCOL_VERSION]);
    expect(COMPATIBILITY_MATRIX.sampling).toBe(false);
    expect(COMPATIBILITY_MATRIX.sourceWrite).toBe(false);
    expect(COMPATIBILITY_MATRIX.streamableHttpSession).toBe(false);
    expect(COMPATIBILITY_MATRIX.tools).toEqual(["canary.run", "canary.evidence", "canary.structure", "canary.submit_proposal"]);
  });

  it("serves a modern client with per-request _meta without initialize", async () => {
    const server = new CanaryMcpServer({ token: "secret", ports: ports() });
    const discover = await server.handleRequestAsync({
      jsonrpc: "2.0",
      id: 1,
      method: "server/discover",
      params: { _meta: modernMeta() },
    });
    expect(discover?.result).toMatchObject({ supportedVersions: [MODERN_PROTOCOL_VERSION, LEGACY_PROTOCOL_VERSION] });
    const listed = await server.handleRequestAsync({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: { _meta: modernMeta() },
    });
    expect(JSON.stringify(listed?.result)).toContain("canary.run");
    const ran = await server.handleRequestAsync({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "canary.run", arguments: { caseId: "smoke" }, _meta: modernMeta() },
    });
    expect(JSON.stringify(ran?.result)).toContain("run_1");
    expect(JSON.stringify(ran?.result)).toContain("io.modelcontextprotocol/serverInfo");
  });

  it("serves a legacy client through initialize and capability negotiation", async () => {
    const server = new CanaryMcpServer({ token: "secret", ports: ports() });
    const init = await server.handleRequestAsync({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: LEGACY_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "legacy", version: "1" } },
    });
    expect(init?.result).toMatchObject({ protocolVersion: LEGACY_PROTOCOL_VERSION, capabilities: { tools: {} } });
    expect(await server.handleRequestAsync({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    })).toMatchObject({ error: { message: expect.stringMatching(/not initialized/) } });
    expect(server.handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    const listed = await server.handleRequestAsync({ jsonrpc: "2.0", id: 3, method: "tools/list" });
    expect(JSON.stringify(listed?.result)).toContain("canary.evidence");
  });

  it("rejects unsupported versions, missing modern _meta, and forcing modern through initialize", async () => {
    const server = new CanaryMcpServer({ token: "secret", ports: ports() });
    const unknown = await server.handleRequestAsync({
      jsonrpc: "2.0", id: 1, method: "tools/list",
      params: { _meta: { [PROTOCOL_VERSION_KEY]: "1900-01-01", [CLIENT_CAPABILITIES_KEY]: {} } },
    });
    expect(unknown?.error?.code).toBe(UNSUPPORTED_PROTOCOL_VERSION);
    expect((unknown?.error?.data as { supported: string[] }).supported).toEqual([MODERN_PROTOCOL_VERSION, LEGACY_PROTOCOL_VERSION]);

    const noMeta = await server.handleRequestAsync({ jsonrpc: "2.0", id: 2, method: "server/discover", params: {} });
    expect(noMeta?.error?.message).toMatch(/_meta/);

    const modernInit = await server.handleRequestAsync({
      jsonrpc: "2.0", id: 3, method: "initialize",
      params: { protocolVersion: MODERN_PROTOCOL_VERSION, capabilities: {} },
    });
    expect(modernInit?.error?.code).toBe(UNSUPPORTED_PROTOCOL_VERSION);

    const legacyInMeta = await server.handleRequestAsync({
      jsonrpc: "2.0", id: 4, method: "tools/list",
      params: { _meta: { [PROTOCOL_VERSION_KEY]: LEGACY_PROTOCOL_VERSION, [CLIENT_CAPABILITIES_KEY]: {} } },
    });
    expect(legacyInMeta?.error?.message).toMatch(/initialize/);
  });

  it("rejects malformed packets, reconnects a new legacy session, and cancels in-flight work", async () => {
    const server = new CanaryMcpServer({ token: "secret", ports: ports({
      async run(_input, signal) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 2000);
          signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("aborted")); });
        });
        return { runId: "late" };
      },
    }) });
    const malformed = await server.handleRequestAsync("{not json");
    expect(malformed?.error?.code).toBe(-32700);
    const batch = server.handleMessage([{ jsonrpc: "2.0", id: 1, method: "ping" }]);
    expect(batch?.error?.message).toMatch(/batches/);

    await server.handleRequestAsync({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: LEGACY_PROTOCOL_VERSION, capabilities: {} } });
    server.handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" });
    server.reconnect();
    const after = await server.handleRequestAsync({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(after?.error?.message).toMatch(/Method not found|not initialized/);

    const modern = new CanaryMcpServer({ token: "secret", ports: ports({
      async run(_input, signal) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 2000);
          signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("aborted")); });
        });
        return { runId: "late" };
      },
    }) });
    const pending = modern.handleRequestAsync({
      jsonrpc: "2.0", id: 9, method: "tools/call",
      params: { name: "canary.run", arguments: {}, _meta: modernMeta() },
    });
    modern.handleMessage({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 9 } });
    const cancelled = await pending;
    expect(cancelled?.error?.code).toBe(REQUEST_CANCELLED);
  });

  it("does not let tool arguments raise authorization, rebind the project, or write source", async () => {
    const server = new CanaryMcpServer({ token: "secret", ports: ports() });
    const elevated = await server.handleRequestAsync({
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "canary.run", arguments: { token: "admin", mode: "hard", write: true, projectRoot: "/other" }, _meta: modernMeta() },
    });
    expect(elevated?.error?.message).toMatch(/authorization|project|credentials/);

    const unknownTool = await server.handleRequestAsync({
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "canary.apply", arguments: {}, _meta: modernMeta() },
    });
    expect(unknownTool?.error?.message).toMatch(/Unknown or disabled/);

    const sampling = await server.handleRequestAsync({
      jsonrpc: "2.0", id: 3, method: "sampling/createMessage",
      params: { _meta: modernMeta() },
    });
    expect(sampling?.error?.message).toMatch(/Method not found/);

    const interactive = await server.handleRequestAsync({
      jsonrpc: "2.0", id: 4, method: "tools/call",
      params: { name: "canary.run", arguments: { headless: false }, _meta: modernMeta() },
    });
    expect(interactive?.error?.message).toMatch(/headless only/);
  });

  it("exposes evidence and unapproved proposal tools without source write", async () => {
    const server = new CanaryMcpServer({ token: "secret", ports: ports() });
    const evidence = await server.handleRequestAsync({
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "canary.evidence", arguments: { runId: "run_1" }, _meta: modernMeta() },
    });
    expect(JSON.stringify(evidence?.result)).toContain("untrustedEvidence");
    const structure = await server.handleRequestAsync({
      jsonrpc: "2.0", id: 11, method: "tools/call",
      params: { name: "canary.structure", arguments: { runId: "run_1", pathPrefix: "src", offset: 2, maxNodes: 20 }, _meta: modernMeta() },
    });
    expect(structure?.result).toMatchObject({ structuredContent: { kind: "canary.host.structure", runId: "run_1", page: { offset: 2, maxNodes: 20 } } });
    const invalidStructure = await server.handleRequestAsync({
      jsonrpc: "2.0", id: 12, method: "tools/call",
      params: { name: "canary.structure", arguments: { runId: "run_1", pathPrefix: "../outside" }, _meta: modernMeta() },
    });
    expect(invalidStructure?.error?.message).toMatch(/project relative/);
    const proposal = await server.handleRequestAsync({
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: {
        name: "canary.submit_proposal",
        arguments: { proposal: { v: 1, kind: "canary.host.proposal", runId: "run_1" } },
        _meta: modernMeta(),
      },
    });
    expect(JSON.stringify(proposal?.result)).toMatch(/recorded_unapproved|not_approved/);
    expect(JSON.stringify(proposal?.result)).not.toMatch(/"approved"\s*:\s*true/);
  });

  it("requires a construction-time token and serves stdio NDJSON without initialize for modern clients", async () => {
    expect(() => new CanaryMcpServer({ token: " ", ports: ports() })).toThrow(/token/);
    const server = new CanaryMcpServer({ token: "secret", ports: ports() });
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on("data", (chunk) => { chunks.push(String(chunk)); });
    const serving = serveStdio(server, stdin, stdout);
    stdin.write(`${JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "server/discover", params: { _meta: modernMeta() },
    })}\n`);
    stdin.write(`${JSON.stringify({
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "canary.run", arguments: {}, _meta: modernMeta() },
    })}\n`);
    stdin.end();
    await serving;
    const body = chunks.join("");
    expect(body).toContain("supportedVersions");
    expect(body).toContain("run_1");
  });

  it("enforces the concurrent resource limit", async () => {
    const server = new CanaryMcpServer({ token: "secret", maxConcurrent: 1, ports: ports({
      async run(_input, signal) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 80);
          signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("aborted")); });
        });
        return { runId: "slow" };
      },
    }) });
    const first = server.handleRequestAsync({
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "canary.run", arguments: {}, _meta: modernMeta() },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await server.handleRequestAsync({
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "canary.run", arguments: {}, _meta: modernMeta() },
    });
    expect(second?.error?.message).toMatch(/resource limit/);
    await first;
  });
});
