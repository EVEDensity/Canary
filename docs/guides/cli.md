# CLI verification

Install Canary from the [GitHub source workflow](getting-started.md), then run in your target project or a subdirectory. Use `canary help` for the current command syntax and `canary version --json` for the executable version. No npm publication or account is required.

## Check and diagnose

```sh
canary run --ci
canary run --ci --project <directory>
canary verify <runId> --json
canary diagnostics <runId>
```

CI mode runs the existing check plan and writes local artifacts without a report server. Preserve the exit code and run ID; failed, blocked and incomplete results are not passing evidence. `verify` checks artifact integrity, and `diagnostics` reads retained failures, redacted logs and reported positions. Run the latter commands in the original project or select its existing configuration with `--config <path>`.

## Reproduce and verify

```sh
canary reproduce <runId> --check <checkId>
canary reproduce <runId> --check <checkId> --prepare
canary reproduce <runId> --check <checkId> --execute --workspace <workspaceId>
canary repair-verify <baselineRunId> <candidateRunId> --regression <checkId> --test <test.spec.mjs>
canary change-verify <runId> --base <commit-or-ref>
```

Reproduction previews conditions by default. Preparation creates a separate source checkout; execution requires the selected action and ready dependencies, runtime, environment, services and data. Canary does not install project dependencies automatically. Repair verification assesses retained evidence by default; add `--execute` only when baseline regression execution is within the task's authorization. Change verification reads historical source and writes an artifact associated with the retained run. Coverage measurements and declared behavior assertions remain distinct.

See [reproduction](reproduction.md), [repair verification](repair-verification.md) and [change verification](change-verification.md) for requirements and result interpretation. Project code runs with host permissions; separate processes/checkouts do not provide an operating system sandbox. Gathering verification evidence does not grant source-edit, network, publication or merge permission.

## Skill and host integration

```sh
canary skill install
canary skill status --json
canary mcp matrix
```

The [official Skill](skills.md) supports the current task with project-local discovery and managed updates. The [MCP server](mcp.md) exposes the same bounded project evidence and verification actions to a host. Existing reviewed experiences distinguish selection from actual function-context delivery; see [project experience](r8-project-experience.md).

中文：CLI 沿现有检查和证据链提供检查、诊断、复现与修复/变更验证。保留真实退出码和 run ID；默认预览/评估不等于执行成功。执行需任务授权和已准备的条件，缺失证据保持未知、阻塞或不足。官方 Skill 与 MCP 指南提供项目内集成方式。
