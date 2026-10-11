# MCP host integration

The Canary MCP server connects a host to one trusted local project. Install Canary using the [GitHub source workflow](getting-started.md), start it from the target project, and use the existing configuration when needed:

```sh
canary mcp matrix
canary mcp serve --config <path>
```

Set `CANARY_MCP_TOKEN` in the host's process environment before `serve`, or supply `--token <token>` at startup. Keep that value out of tool arguments and retained artifacts. The transport is newline-delimited JSON-RPC over stdio; the local host controls the launched process and its pipe. It is not a remote HTTP authentication service. The project is bound once at startup; tools cannot change the project, configuration, credentials or authorization.

## Read retained evidence

- `canary.evidence`: bounded run/check summaries, redacted diagnostics and available experience delivery metadata.
- `canary.diagnostics`: a bounded page of retained failures and source positions; pass `maxChecks` and `checkOffset` as needed.
- `canary.structure`: a bounded page of sealed historical structure; missing snapshots are not reconstructed from current source.
- `canary.verification`: read an existing receipt with `runId` and `kind: repair|change|reproduction`. Missing/incompatible receipts return unavailable; incomplete historical evidence cannot become verified.

Evidence reads require a sealed run in the bound project's artifact collection. Follow pagination metadata instead of treating a bounded page as a complete result. Truncated receipts direct you to the CLI or full project artifact. Source positions and hashes do not establish a root cause or artifact authorship.

## Execute a scoped operation

- `canary.run` runs the bound project's checks in headless mode. It writes artifacts and executes project commands with host permissions.
- `canary.reproduce` requires `runId` and `checkId`; it previews conditions by default.
- `canary.repair_verify` requires `runId`, `candidateRunId`, regression check IDs in `regression`, and project-relative test files in `tests`; it assesses retained evidence by default.
- `canary.change_verify` requires `runId` and a Git baseline in `base`; it writes a change-verification artifact using historical source.
- `canary.submit_proposal` records an unapproved host proposal; recording it does not approve or apply a change.

Reproduction and repair require an explicit `action: prepare|execute` to create workspaces or execute regression checks. Prepared workspace IDs can be reused through `workspace` and, for repair, `candidateWorkspace`. Tool names use underscores in `repair_verify` and `change_verify`; the CLI uses hyphens. Operations reuse the existing CLI's source, runtime, prerequisite and evidence checks. Read the [CLI guide](cli.md) and operation-specific guides before execution.

The tool schema does not accept environment values, credential forwarding or fabricated service/data acknowledgements. Missing prerequisites remain blocked; use the authorized CLI preparation workflow when explicit environment forwarding is required. The MCP server does not edit application source, merge, activate experience, or confer permission to run untrusted commands. Cancellation and concurrency limits do not turn project code into an operating system sandbox.

A cancelled operation or nonzero child process cannot return `verified`. Preserve its exit code and interrupted/failed/insufficient result, then inspect the retained evidence before choosing another execution.

## Compatibility scope

`canary mcp matrix` reports this server's supported protocol/transport declarations and tool inventory. Server tests exercise the Canary protocol client; those declarations are separate from verified interoperability with every external MCP host. Sampling and Streamable HTTP sessions are not implemented. Use the [official Skill guide](skills.md) for client-discovered task instructions rather than assuming MCP installs a Skill.

中文：MCP 在启动时绑定一个受信任项目，通过 stdio 提供限量、脱敏的封存证据与 CLI 同源验证操作。token 由宿主启动环境提供，工具参数不能切换项目、传凭据或提高授权。复现/修复默认预览或评估，prepare/execute 必须显式选择；缺失条件仍阻塞。兼容声明和测试客户端通过不等于所有第三方宿主已实测。
