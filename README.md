# canary

`canary` runs a local TypeScript Agent like an end-to-end test, records trajectory + source coverage, and turns failures into auditable regression work. It does not edit Agent source.

![Local UI overview](docs/images/ui-overview.png)

## Quick Start

```powershell
pnpm install
pnpm canary -- run
```

Headless (CI):

```powershell
pnpm canary -- run --headless --no-open
```

Default suite: 15 deterministic cases under `cases/` against `examples/local-agent` (no API keys). Artifacts: `.canary/artifacts/<runId>/`.

```powershell
pnpm canary -- show <runId>
pnpm canary -- report <runId> --format markdown
pnpm canary -- replay <runId> --headless --no-open
```

## Support matrix

| Target         | Adapter                  | Coverage                                     |
| -------------- | ------------------------ | -------------------------------------------- |
| Local TS Agent | `function`               | V8 lines / branches / functions / statements |
| HTTP Agent     | `http`                   | `unavailable`                                |
| MCP Agent      | `mcp` stdio              | `unavailable`                                |
| MCP tools      | `mcp-stdio` / `mcp-http` | N/A (tools)                                  |
| Bun            | CLI smoke only           | not claimed                                  |

Coverage is never faked: missing instrumentation is `unavailable`, not 0% or 100%. Feature hit-rate is not “model intelligence”.

## Cannot measure

Remote black-box reasoning quality, non-Node languages, browsers, or Docker sandboxes. Judge scores are optional and fail closed on error, timeout, or low confidence.

## Security

Local-first. No default outbound model. The runner is not a sandbox. See [SECURITY.md](./SECURITY.md).

## Docs

[Getting Started](docs/getting-started.md) · [Agent Adapter](docs/agent-adapter.md) · [MCP](docs/mcp.md) · [Mock Environment](docs/mock-environment.md) · [Feature Coverage](docs/feature-coverage.md) · [Local UI](docs/local-ui.md) · [CI](docs/ci.md) · [Replay](docs/replay.md) · [Self-improvement](docs/self-improvement.md) · [Troubleshooting](docs/troubleshooting.md) · [Architecture](docs/architecture.md) · [10-minute acceptance](docs/acceptance-10-min.md)
