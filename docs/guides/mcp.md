# MCP host integration

The Canary MCP server connects a host to one trusted local project. Install Canary using the [GitHub source workflow](getting-started.md), start it from the target project, and use the existing configuration when needed:

```sh
canary mcp matrix
canary mcp serve --config <path>
```

Set `CANARY_MCP_TOKEN` in the host's process environment before `serve`, or supply `--token <token>` at startup. Keep that value out of tool arguments and retained artifacts. The transport is newline-delimited JSON-RPC over stdio; the local host controls the launched process and its pipe. It is not a remote HTTP authentication service. The project is bound once at startup; tools cannot change the project, configuration, credentials or authorization.

## Read retained evidence

- `canary.assessment`: read the shared quality brief and existing choices for a sealed `runId`. CLI, MCP and workspace return the same view: scope, counts, issue/evidence references, rule-derived recommendations, alternatives, uncertainty and decision revision. No model call or decision write occurs. Unknown token/cost telemetry stays unknown; source gaps are not filled in from current files.
- `canary.improvements`: read bounded controlled-improvement sessions for a sealed `runId`, including fixed plans, charged attempts, paired benefit and candidate-evidence availability. The tool does not prepare or execute candidates. Execution remains an explicit CLI/host operation within the task's authorization.
- `canary.evidence`: bounded run/check summaries, redacted diagnostics and available experience delivery metadata.
- `canary.diagnostics`: a bounded page of retained failures and source positions; pass `maxChecks` and `checkOffset` as needed.
- `canary.structure`: a bounded page of sealed historical structure; missing snapshots are not reconstructed from current source.
- `canary.verification`: read an existing receipt with `runId` and `kind: repair|change|reproduction`. Change results validate the same run/source/configuration/execution binding as the CLI and page, with separate execution denominators, unknown-file counts and explicit behavior. Missing/incompatible receipts return unavailable; historical version 1 records have no version 2 quantitative assessment.
- `canary.repair_task`: create a read-only [repair task bundle](repair-tasks.md) with `runId`, optional failed check IDs in `checks`, and project-relative files/directories in `allowedPaths`. Returns the same bundle as the CLI, within 65,536 encoded bytes; it does not execute checks or grant repair permission.
- `canary.memory`: query [historical repair facts](project-memory.md) with a sealed failed `runId`, optional `checks`, `maxItems` (1–10, default 5) and `maxChars` (512–32,768, default 8,000). Results retain project/check/source identity, match conditions and omissions within 64 KiB. `related` is historical evidence, not proof of the selected failure's repair; changed conditions require revalidation. This tool cannot record, revoke, activate or inject memory.

Evidence reads require a sealed run in the bound project's artifact collection. Follow pagination metadata instead of treating a bounded page as a complete result. Truncated receipts direct you to the CLI or full project artifact. Source positions and hashes do not establish a root cause or artifact authorship.

Repair task scope must include the authorized source, regression test and any new check configuration. Missing scope remains blocked; the tool does not expand it. Use CLI `repair-task verify` for offline integrity and `repair-task check` to assess a sealed candidate in the original project. Candidate admission is `ready-for-regression`, never repair verification; the existing `canary.repair_verify` operation provides the subsequent regression evidence.

## Record a guided choice

Decision recording is disabled and absent from `tools/list` by default. Enable it only in the trusted server startup:

```sh
canary mcp serve --config <path> --allow-assessment-decisions
```

`canary.assessment_decide` requires `runId`, current `reportHash`, `expectedRevision`, `optionId`, `action: select|reject`, `actor` and `reason`. It records a direction without executing checks, editing source, approving a repair or activating experience. `actor` is caller-declared audit metadata, not authenticated human approval; tool arguments cannot enable the capability. Conversation does not require a stored choice.

The shared view is bounded to 64 KiB, with up to the latest 16 choices and explicit omission counts. Separate records under `<artifactRoot>/.quality` retain up to 8 report versions and 32 choices per run without changing the run manifest. Changed evidence makes older choices stale. Stale hashes/revisions, corrupt records and unavailable evidence reject mutations. `error.data.qualityCode` preserves `QUALITY_STALE`, `QUALITY_BUSY`, `QUALITY_STORAGE`, `QUALITY_EVIDENCE` or `QUALITY_INPUT`; inspect the condition and refresh before retrying.

## Execute a scoped operation

- `canary.run` runs the bound project's checks in headless mode. It writes artifacts and executes project commands with host permissions.
- `canary.reproduce` requires `runId` and `checkId`; it previews conditions by default.
- `canary.repair_verify` requires `runId`, `candidateRunId`, regression check IDs in `regression`, and project-relative test files in `tests`; it assesses retained evidence by default.
- `canary.change_verify` requires `runId` and a Git ancestor baseline in `base`; it writes a sealed change-verification artifact using historical source and returns a bounded acknowledgement with up to 12 gaps. Read the full artifact through the CLI when gaps are omitted. Source mismatches and unsupported evidence remain unknown; ordinary gaps do not create CI gates.
- `canary.submit_proposal` records an unapproved host proposal; recording it does not approve or apply a change.

Reproduction and repair require an explicit `action: prepare|execute` to create workspaces or execute regression checks. Prepared workspace IDs can be reused through `workspace` and, for repair, `candidateWorkspace`. Tool names use underscores in `repair_verify` and `change_verify`; the CLI uses hyphens. Operations reuse the existing CLI's source, runtime, prerequisite and evidence checks. Read the [CLI guide](cli.md) and operation-specific guides before execution.

The tool schema does not accept environment values, credential forwarding or fabricated service/data acknowledgements. Missing prerequisites remain blocked; use the authorized CLI preparation workflow when explicit environment forwarding is required. The MCP server does not edit application source, merge, activate experience, or confer permission to run untrusted commands. Cancellation and concurrency limits do not turn project code into an operating system sandbox.

A cancelled operation or nonzero child process cannot return `verified`. Preserve its exit code and interrupted/failed/insufficient result, then inspect the retained evidence before choosing another execution.

## Compatibility scope

`canary mcp matrix` reports this server's supported protocol/transport declarations and tool inventory. Server tests exercise the Canary protocol client; those declarations are separate from verified interoperability with every external MCP host. Sampling and Streamable HTTP sessions are not implemented. Use the [official Skill guide](skills.md) for client-discovered task instructions rather than assuming MCP installs a Skill.

中文：MCP 在启动时绑定受信任项目，通过 stdio 共享封存证据、质量简报和同源验证操作。`assessment` 只读；`assessment_decide` 必须通过启动参数显式启用，仅记录方向，不授予执行或审批。工具不能切换项目、传凭据或提高授权；兼容声明与逐客户端实测分别记录。
