import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { createFunctionAdapter, createHttpAdapter, createMcpAdapter, createToolAdapter, McpHttpToolAdapter, McpStdioToolAdapter, MockToolAdapter, runHttpAgent } from "../src/index.js";

describe("agent and tool adapters", () => {
  it("runs a local function agent", async () => {
    const adapter = createFunctionAdapter(async (input) => ({ echo: input }));
    const output = await adapter.run({ value: "ok" }, { executionId: "e1", emit: () => undefined });
    expect(adapter.kind).toBe("function");
    expect(output.value).toEqual({ echo: "ok" });
  });

  it("runs an HTTP black-box agent", async () => {
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ output: JSON.parse(body).input, remote: true }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    try {
      const adapter = createHttpAdapter(`http://127.0.0.1:${port}/agent`);
      const output = await adapter.run({ value: "remote-task" }, { executionId: "e2", emit: () => undefined });
      expect(adapter.kind).toBe("http");
      expect(output.value).toMatchObject({ output: "remote-task", remote: true });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("calls mock tools and an MCP stdio tool adapter separately from AgentAdapter", async () => {
    const mock = new MockToolAdapter({ lookup: (args) => `found:${String((args as { q?: string }).q ?? "")}` });
    expect(mock.kind).toBe("mock");
    expect(await mock.call("lookup", { q: "alpha" })).toBe("found:alpha");
    await mock.close();

    const mcp = new McpStdioToolAdapter(process.execPath, ["-e", "process.stdin.setEncoding('utf8'); let b=''; process.stdin.on('data',c=>{b+=c; const i=b.indexOf('\\n'); if(i>=0){ const m=JSON.parse(b.slice(0,i)); process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{ok:m.params.name}})+'\\n'); }});"]);
    expect(mcp.kind).toBe("mcp-stdio");
    try {
      expect(await mcp.call("search", { q: 1 })).toEqual({ ok: "search" });
    } finally {
      await mcp.close();
    }
  });

  it("runs an MCP agent adapter over stdio tools/call run", async () => {
    const script = "process.stdin.setEncoding('utf8'); let b=''; process.stdin.on('data',c=>{b+=c; const i=b.indexOf('\\n'); if(i>=0){ const m=JSON.parse(b.slice(0,i)); process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{output:m.params.arguments}})+'\\n'); }});";
    const adapter = createMcpAdapter(process.execPath, ["-e", script]);
    const output = await adapter.run({ value: { goal: "mcp" } }, { executionId: "e3", emit: () => undefined });
    expect(adapter.kind).toBe("mcp");
    expect(output.value).toEqual({ output: { goal: "mcp" } });
  });

  it("calls MCP HTTP JSON and SSE demo transports (not full Streamable HTTP)", async () => {
    const jsonServer = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { via: "json" } }));
    });
    await new Promise<void>((resolve) => jsonServer.listen(0, "127.0.0.1", () => resolve()));
    const jsonPort = typeof jsonServer.address() === "object" && jsonServer.address() ? jsonServer.address()!.port : 0;
    const sseServer = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { via: "sse" } })}\n\n`);
    });
    await new Promise<void>((resolve) => sseServer.listen(0, "127.0.0.1", () => resolve()));
    const ssePort = typeof sseServer.address() === "object" && sseServer.address() ? sseServer.address()!.port : 0;
    try {
      const json = new McpHttpToolAdapter(`http://127.0.0.1:${jsonPort}/mcp`);
      const sse = await createToolAdapter({ adapter: "mcp-http", url: `http://127.0.0.1:${ssePort}/mcp` });
      expect(await json.call("lookup", { q: 1 })).toEqual({ via: "json" });
      expect(await sse.call("lookup", { q: 1 })).toEqual({ via: "sse" });
      await json.close();
      await sse.close();
    } finally {
      await new Promise<void>((resolve) => jsonServer.close(() => resolve()));
      await new Promise<void>((resolve) => sseServer.close(() => resolve()));
    }
  });

  it("aborts an in-flight HTTP agent request instead of only stopping the waiter", async () => {
    let aborted = false;
    const server = createServer((request, response) => {
      request.on("aborted", () => { aborted = true; });
      request.on("close", () => { if (!response.writableEnded) aborted = true; });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const controller = new AbortController();
    try {
      const pending = runHttpAgent(`http://127.0.0.1:${port}/agent`, "hang", 10_000, controller.signal);
      await new Promise((resolve) => setTimeout(resolve, 40));
      controller.abort();
      await expect(pending).rejects.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(aborted).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("keeps ModelProvider as an independent module from AgentAdapter, ToolAdapter, and JudgeProvider", async () => {
    const { createModelProvider } = await import("../src/model.js");
    const model = createModelProvider("deterministic", { "hello": "world" });
    expect(model.kind).toBe("deterministic");
    expect(typeof model.complete).toBe("function");
    expect((model as { score?: unknown }).score).toBeUndefined();
    expect((await model.complete("hello")).text).toBe("world");
    expect((await model.complete("plan:task")).text).toBe("planned:task");
    expect((await createModelProvider("echo").complete("raw")).text).toBe("raw");
  });
});
