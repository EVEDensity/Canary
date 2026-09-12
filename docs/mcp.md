# MCP

MCP is a **tool protocol**, not automatically an Agent entry protocol.

- **MCP ToolAdapter** (`tools.adapter: "mcp-stdio"` or `"mcp-http"`): the Function Agent calls `ctx.tools.call`. Demo tools live in `examples/local-agent/servers/mcp-tools.ts`.
- **MCP AgentAdapter** (`agent.adapter: "mcp"`): the whole Agent is a stdio process. Demo: `examples/mcp-agent`.

Coverage for a remote/stdio Agent is `unavailable`. Unexpected policy events still fail the hard gate.

```powershell
pnpm canary -- run --headless --no-open --config examples/mcp-agent/canary.config.ts
```
