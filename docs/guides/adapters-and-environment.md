# Adapters and execution environments

Canary supports three application adapters:

- `function`: a JavaScript or TypeScript entry executed in a Node.js child process. Supported collectors can measure included source files.
- `http`: POST JSON to a configured endpoint. The default request body is `{ "input": ... }`; `agent.requestField` can select another top-level field.
- `mcp`: invoke the configured service's `run` tool. Other tools can be integrated through a function entry and the tool adapter.

Tool adapters include deterministic fixtures, stdio services and HTTP services. Confirm transport and protocol compatibility before integrating a service. Remote execution does not automatically provide internal source coverage.

Function context provides events, tools and managed state. State snapshots restore managed memory; they do not reverse filesystem changes or remote side effects.

Reviewed experiences can be passed as `context.experiences` to the function adapter. Run evidence distinguishes `selected` from acknowledged `delivered` context, including the case/execution IDs and content hashes. That acknowledgement does not establish agent use or improvement. HTTP and MCP application adapters do not inject these experiences and record delivery as `unsupported`; ordinary command checks also receive no experience context. See [project experience](r8-project-experience.md).

## Structured integration

`canary mcp serve` exposes project-bound run, evidence, diagnostics, structure, verification and proposal operations. Structure queries read sealed run snapshots with bounded pagination. Proposals remain review records until approved through the control workflow. The Canary host MCP server is distinct from an application's `mcp` adapter; see the [MCP guide](mcp.md) and [official Skill](skills.md).

Configuration and application code must be trusted. See [configuration](r4-project-checks.md), [coverage](evaluation-and-coverage.md) and [security policy](../../SECURITY.md).

Worker control messages use a private per-execution nonce; import-time messages and public IPC calls cannot supply valid completion or delivery evidence. This protects the worker protocol from ordinary message spoofing. Function code still shares a Node process with the worker and is not isolated from arbitrary malicious code or debugger access.
