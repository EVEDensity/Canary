import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { createFunctionAdapter, createHttpAdapter, McpStdioToolAdapter, MockToolAdapter } from "../src/index.js";

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
});
