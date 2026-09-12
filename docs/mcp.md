# MCP

MCP is a **tool protocol**, not automatically an Agent entry protocol.

- **MCP ToolAdapter** (`tools.adapter: "mcp-stdio"` or `"mcp-http"`): the Function Agent calls `ctx.tools.call`. Demo tools live in `examples/local-agent/servers/mcp-tools.ts`.
- **MCP AgentAdapter** (`agent.adapter: "mcp"`): the whole Agent is a stdio process. Demo: `examples/mcp-agent`.

`mcp-http` in v0.1 is a JSON-RPC POST / SSE demo. **Full MCP Streamable HTTP session lifecycle is out of v0.1.**

Coverage for a remote/stdio Agent is `unavailable`. Unexpected policy events still fail the hard gate.

From the repo root (after `pnpm install`):

```powershell
pnpm canary -- run --headless --no-open --config examples/mcp-agent/canary.config.ts
```
