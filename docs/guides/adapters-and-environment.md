# Adapters and execution environments

Canary supports three application adapters:

- `function`: a JavaScript or TypeScript entry executed in a Node.js child process. Supported collectors can measure included source files.
- `http`: POST JSON to a configured endpoint. The default request body is `{ "input": ... }`; `agent.requestField` can select another top-level field.
- `mcp`: invoke the configured service's `run` tool. Other tools can be integrated through a function entry and the tool adapter.

Tool adapters include deterministic fixtures, stdio services and HTTP services. Confirm transport and protocol compatibility before integrating a service. Remote execution does not automatically provide internal source coverage.

Function context provides events, tools and managed state. State snapshots restore managed memory; they do not reverse filesystem changes or remote side effects.

## Structured integration

`canary mcp serve` exposes run, evidence, structure and proposal operations. Structure queries read sealed run snapshots with bounded pagination. Proposals remain review records until approved through the control workflow.

Configuration and application code must be trusted. See [configuration](r4-project-checks.md), [coverage](evaluation-and-coverage.md) and [security policy](../../SECURITY.md).
