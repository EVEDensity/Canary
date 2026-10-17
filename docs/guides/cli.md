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

## Measure analysis overhead

```sh
canary profile <runId> --samples 3 --json
```

`profile` is read-only and accepts 1–5 samples (default 1), `--project <directory>` and `--config <path>`. It measures discovery, structure build, evidence verification, quality-brief generation and project-memory lookup without importing project configuration or running checks, Agents or models. Each stage returns actual duration samples/minimum/median/maximum, available scope counts and input identity, consistency, a status code and next action. Missing inputs remain unavailable; blocked stages return exit 1, invalid arguments exit 2. Missing measurements are not zero-cost or successful validation.

The report includes input and elapsed budgets. Samples are sequential observations of current source and retained evidence, not a production latency guarantee. The time budget is checked between synchronous operations; see [maintenance](local-log-maintenance.md) for recovery and retention boundaries.

## Assess and choose a next step

```sh
canary assess <runId> --json
canary assess <runId> --project <directory> --json
canary assess decide <runId> --report-hash <hash> --expected-revision <revision> --option <optionId> --action select --actor maintainer --reason "Review the failing behavior" --json
```

`assess` is read-only: it generates a bounded brief from sealed Agent/project results, coverage and linked history without running checks or a model. CLI, MCP and workspace share its report, recommendations, options and existing decisions. Read the current report's `contentHash`, view `revision` and option ID before recording a choice. Both commands support `--project <directory>`, `--config <path>` and `--json`; use `--action reject` to record a rejection.

Only `assess decide` writes a selection. Actor/reason are audit metadata; a choice is not execution, authenticated approval or verified improvement. Recommendations follow evidence rules, not a model-confirmed root cause. Reuse already selected directions; ordinary conversation need not write a record.

Choices live outside sealed runs in `<artifactRoot>/.quality`, with up to 8 report versions and 32 choices per run. The shared 64 KiB view includes up to the latest 16 choices and omission counts. A manifest change marks old choices stale. Stale revisions, corrupt state and unavailable evidence reject writes; historical gaps remain unknown rather than being reconstructed from current source.

## Controlled Agent improvement

```sh
canary improvement prepare <runId> --option <optionId> --report-hash <hash> --expected-revision <revision> --entry candidate.mjs --allow candidate.mjs --allow tools.mjs --regression <failedCase> --holdout <passingCase> --max-runs 1 --max-cases 8 --max-ms 60000 --max-tool-calls 32 --config <agent-config> --json
canary improvement execute <sessionId> --plan-hash <planHash> --actor maintainer --reason "Verify the reviewed candidate" --execute --config <agent-config> --json
canary improvement show <sessionId> --config <agent-config> --json
```

`prepare` freezes a current selected Agent option, sealed baseline, all original case contracts/repetitions, candidate identity, regression/holdout scopes and cumulative budgets without importing project modules. Repeat `--allow`, `--regression` and `--holdout` as needed. Include the mock-tool entry in allowed files. `execute` charges a durable attempt before configuration loading and requires the reviewed plan hash plus explicit execution request. Source/selection drift, stopped attempts and exhausted limits block further execution; there is no automatic retry.

The supported executor uses trusted function Agents, mock tools and serializable deterministic contracts without loaded experience. It disables managed live calls; observed tool limits do not meter arbitrary outbound code or provider billing. An execution exit of 0 requires observed fixed-contract improvement, at least five paired trials, no regressions, passing holdout and successful run gates. Small samples, missing contracts or unknown costs remain explicit. `show` is read-only; records are stored under `<artifactRoot>/.improvements`, outside sealed runs. See [the complete workflow](agent-workflow.md).

Executable configuration runs in a Worker with a responsive supervisor, deadline, bounded output and parent-disconnect handling. It is not an operating system sandbox.

### Recover an interrupted attempt

```sh
canary improvement recover <sessionId> --config <agent-config> --json
canary improvement recover <sessionId> --apply --session-hash <sessionHash> --lock-hash <lockHash-or-absent> --actor maintainer --reason "Close the interrupted attempt" --config <agent-config> --json
```

The default command only inspects the ledger. `--apply` requires the exact previewed hashes and an actor/reason; pass the literal `absent` when the preview reports no lock. Only a proven absent owner can be recovered. Live or unknown owners, mismatched identity, changed records and interrupted recovery guards remain blocked. Recovery records an interrupted result with unknown observed metrics, keeps the attempt consumed and does not rerun work, verify a fix or terminate stored PIDs. Preserve a blocked guard for inspection. See [the workflow](agent-workflow.md).

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

## Reuse verified repair history

```sh
canary memory record <candidateRunId> --actor maintainer --reason "Reviewed regression evidence"
canary memory query <failedRunId> --check <checkId> --max-items 5 --max-chars 8000
canary memory list --json
canary memory revoke <memoryId> --actor maintainer --reason "Superseded repair"
```

[Project memory](project-memory.md) rechecks sealed repair facts before recording or retrieval. `related` and `needs-revalidation` describe historical evidence, never a verified current fix. Recording accepts an expiry of 1–365 days (default 90) and requires `--ack-review` when reviewed advisories exist. Lookup is bounded, project-scoped and read-only; unavailable results have unknown counts.

## Skill and host integration

```sh
canary skill install
canary skill status --json
canary mcp matrix
```

The [official Skill](skills.md) supports the current task with project-local discovery and managed updates. The [MCP server](mcp.md) exposes the same bounded project evidence and verification actions to a host. Existing reviewed experiences distinguish selection from actual function-context delivery; see [project experience](r8-project-experience.md).

中文：CLI 沿现有证据链提供检查、质量简报、显式选择、修复交接、复现与回归验证。`assess` 只读，`assess decide` 才记录方向；选择、审批与实际执行分别保留。保留真实退出码和 run ID，缺失证据保持未知、阻塞或不足。
