# Agent Adapter

canary never imports your Agent as a trusted library into the CLI process for white-box runs. Each case is an isolated execution.

| `agent.adapter` | `entry`                         | Coverage                                                   |
| --------------- | ------------------------------- | ---------------------------------------------------------- |
| `function`      | Module path + optional `export` | V8 / source-map when files are in `coverage.include`       |
| `http`          | URL                             | `unavailable` unless you ship a Coverage SDK (not in v0.1) |
| `mcp`           | stdio server module             | `unavailable`                                              |

Function agents receive `{ emit, tools, state, model }`. HTTP agents receive `POST { input }`. MCP agents implement JSON-RPC `tools/call` with `name: "run"`.

See `examples/local-agent`, `examples/http-agent`, and `examples/mcp-agent`.
