# CLI verification

Install Canary from the [GitHub source workflow](getting-started.md), then run in your target project or a subdirectory. Use `canary help` for the current command syntax and `canary version --json` for the executable version. No npm publication or account is required.

## Check and diagnose

```sh
canary run --ci
canary run --ci --project <directory>
canary run --ci --base main
canary run --port 4318 --no-open --base main
canary verify <runId> --json
canary diagnostics <runId>
```

CI mode runs the existing check plan and writes local artifacts without a report server. Preserve the exit code and run ID; failed, blocked and incomplete results are not passing evidence. `verify` checks artifact integrity, and `diagnostics` reads retained failures, redacted logs and reported positions. Run the latter commands in the original project or select its existing configuration with `--config <path>`.

Add `--base <commit-or-ref>` to seal a version-bound change analysis after project checks. The report separates measured coverage denominators, unknown files, explicit behavior and verification gaps. Informational gaps and unavailable analysis preserve the check exit code; explicitly required behavior contracts remain CI gates.

## Hand off a repair

```sh
canary repair-task create <runId> --check <checkId> --allow src --allow tests/repair.test.mjs --allow canary.project.json --out repair-task.json
canary repair-task verify repair-task.json
canary repair-task check repair-task.json <candidateRunId>
```

The [repair task](repair-tasks.md) binds retained failures and a declared file/directory scope without running checks. Repeat `--check` or `--allow` as needed; no scope is inferred. Offline `verify` establishes bundle integrity only. Candidate `check` rebinds project evidence, preserves every original check and assesses all committed changes; `ready-for-regression` still means `repairVerified: false`. Continue with the regression workflow below to verify a repair.

## Reproduce and verify

```sh
canary reproduce <runId> --check <checkId>
canary reproduce <runId> --check <checkId> --prepare
canary reproduce <runId> --check <checkId> --execute --workspace <workspaceId>
canary repair-verify <baselineRunId> <candidateRunId> --regression <checkId> --test <test.spec.mjs>
canary change-verify <runId> --base <commit-or-ref>
canary change-verify <runId> --base <commit-or-ref> --summary
```

Reproduction previews conditions by default. Preparation creates a separate source checkout; execution requires the selected action and ready dependencies, runtime, environment, services and data. Canary does not install project dependencies automatically. Repair verification assesses retained evidence by default; add `--execute` only when baseline regression execution is within the task's authorization. Change verification reads historical source and writes an artifact associated with the retained run. Coverage measurements and declared behavior assertions remain distinct.

`change-verify --summary` returns a bounded acknowledgement while retaining the complete sealed JSON report. Missing legacy execution proof or changed source remains unknown; an analysis that cannot complete returns exit code 5 with an unavailable result.

See [reproduction](reproduction.md), [repair verification](repair-verification.md) and [change verification](change-verification.md) for requirements and result interpretation. Project code runs with host permissions; separate processes/checkouts do not provide an operating system sandbox. Gathering verification evidence does not grant source-edit, network, publication or merge permission.

## Skill and host integration

```sh
canary skill install
canary skill status --json
canary mcp matrix
```

The [official Skill](skills.md) supports the current task with project-local discovery and managed updates. The [MCP server](mcp.md) exposes the same bounded project evidence and verification actions to a host. Existing reviewed experiences distinguish selection from actual function-context delivery; see [project experience](r8-project-experience.md).

中文：CLI 沿现有检查和证据链提供检查、诊断、修复交接、复现与修复/变更验证。修复任务的包完整性、候选准入和真正的回归验证分别记录，不能互相替代。保留真实退出码和 run ID；执行需任务授权和已准备的条件，缺失证据保持未知、阻塞或不足。
