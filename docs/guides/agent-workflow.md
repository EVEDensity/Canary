# Agent assessment and guided improvement

Canary brings Agent execution, tool assertions, traces, source coverage, replay and version comparison into one improvement workflow. The official Skill helps a compatible host explain the results, recommend next steps and verify the user's selected action. The CLI and MCP provide execution and retained evidence.

## Ask for an assessment

Install or update the official project Skill with `canary skill install` or `canary skill update`. In a host that has loaded it, ask:

> Assess this Agent using its existing cases. Explain the main failures, recommend a next step and offer alternatives before changing source.

The Skill first identifies the project, Agent configuration, case set and available evidence. A matching retained run can be assessed without another Agent execution. For a new run and its quality brief:

```sh
canary run --ci --config <agent-config>
canary assess <runId> --config <agent-config> --json
canary host evidence <runId> --max-cases 8 --max-events 20 --config <agent-config>
```

Select the Agent configuration explicitly when a project also contains project-check configuration. Automatic script discovery verifies existing project checks; Agent behavior needs an adapter and meaningful cases. If these are missing, the host can propose an adapter/case draft for review, with the required execution conditions.

## Understand the result and choose an action

`assess` is read-only and generates a rule-based brief from sealed evidence. The CLI, MCP and workspace share the same report and recorded choices. It contains:

- The tested Agent version, run/case identities, selected scope and actual result counts.
- Observed task/output failures, tool selection/arguments/order, state or termination failures, environment blockers and verification gaps.
- Source or trajectory references, and a clear distinction between an observation and a root-cause hypothesis.
- A recommended next action with its reason, proposed change scope, expected benefit and validation plan; alternatives when there is a real tradeoff.

For example, a retained wrong-tool assertion may support correcting tool routing, reviewing an ambiguous behavior contract or inspecting the matching trace first. This is an interaction example, not a claimed project failure. The recommendation depends on the actual contract and evidence; it must not silently weaken the assertion.

Open **Issues & improvements** in the workspace to inspect recommendations, follow original evidence, or explicitly select/reject an option with an actor and reason. The Skill can explain the same options in conversation. Recommendations are guidance, not model-confirmed root causes; expected benefits remain hypotheses.

When the task requires retaining a choice, use the current report's `contentHash`, view `revision` and option ID:

```sh
canary assess decide <runId> --report-hash <hash> --expected-revision <revision> --option <optionId> --action select --actor maintainer --reason "Review the failing behavior" --config <agent-config> --json
```

Use `--action reject` to record a rejection. A conversation does not have to create a decision record. A record preserves direction and attribution; it does not execute a repair, approve experience or authenticate the actor. Continue with an already chosen, authorized action without asking the same question again.

Each issue has at most one current selection: a newer selection replaces the previous direction, and rejecting the current option clears it. `selections` preserves this current state independently of the bounded decision history.

Choices are stored outside sealed runs in `<artifactRoot>/.quality`, preserving the run manifest. Each record retains up to 8 report versions and 32 choices; the shared view returns up to the latest 16 choices within 64 KiB and reports omitted counts. A changed manifest makes earlier choices stale. Stale revisions, corrupt records or unavailable evidence reject writes; refresh and inspect the reported state before retrying. Historical evidence is not filled in from current source.

## Execute and compare

The user can request assessment only, select a proposed improvement, or authorize bounded host work. For a selected Agent behavior option, prepare the reviewed candidate within the agreed source scope, then create an immutable verification plan:

For an authorized function-adapter candidate, retain fixed cases, assertions and independent holdout:

```sh
canary improvement prepare <baselineRunId> --option <optionId> --report-hash <hash> --expected-revision <revision> --entry candidate.mjs --allow candidate.mjs --allow tools.mjs --regression <failedCase> --holdout <passingCase> --max-runs 1 --max-cases 8 --max-ms 60000 --max-tool-calls 32 --config <agent-config> --json
canary improvement execute <sessionId> --plan-hash <planHash> --actor maintainer --reason "Verify the reviewed candidate" --execute --config <agent-config> --json
canary improvement show <sessionId> --config <agent-config> --json
```

Preparation reads sealed evidence and source hashes without importing project configuration or case modules. It binds the current selection, baseline manifest, candidate entry/configuration, declared files and recognized source inventory. Repeat `--allow` for the configured mock-tool entry and other reviewed files. All original cases, inputs, assertions and repetitions remain fixed; every original failure belongs to the regression scope, and the disjoint holdout must already pass. At least five paired trials are required for an observed-benefit result. `--max-cases` counts trials across explicit attempts, not distinct case names.

Execution requires the exact plan hash, actor/reason and `--execute`. It charges an attempt before loading configuration, runs sequentially through the existing runner, seals a `candidateOf` run and retains paired changes and available telemetry. Run, case, elapsed-time and observed tool-call budgets are cumulative; no retry starts automatically. Stale choices/source, interrupted state and stopped attempts require inspection and a new reviewed plan. Records live outside sealed runs under `<artifactRoot>/.improvements`.

Executable configuration loads in a Worker behind a responsive supervisor. Deadline, cancellation, excessive output or loss of the parent connection stops the loader; the parent accepts only a bounded response from that invocation. This bounds the managed configuration phase, not operating system permissions or arbitrary project side effects.

This workflow supports function Agents, mock tools and serializable deterministic contracts without loaded experience. Managed tool calls are admitted before invocation, retain their actual name/arguments and use JSON argument snapshots within 64 KiB. Controlled tool assertions use those calls, including the absence of calls; self-reported tool events cannot replace them. Managed live model/Judge calls are disabled. Project code remains trusted: declared scope and managed tool limits are not an operating system sandbox, a transitive dependency inventory or a billing cap on arbitrary outbound code. Tokens and monetary cost remain unknown. Uncalibrated Judge scores, missing trials, changed contracts, regressions and small samples cannot yield a successful benefit exit. Observations apply to the fixed contract, not overall correctness or population performance.

The workspace and read-only MCP `canary.improvements` expose retained sessions and recheck candidate evidence. Candidate execution, source editing and experience activation remain separate actions. HTTP/MCP candidates continue to use a reviewed configuration with `candidate`/`compare`; use [project repair verification](repair-verification.md) for project regressions.

Stop at success, the agreed budget, changed authorization requirements or an unchanged blocker. Continuous improvement is invoked within the task; recurring monitoring needs a separate user request.

## Measure and recover

```sh
canary profile <runId> --samples 3 --config <agent-config> --json
canary improvement recover <sessionId> --config <agent-config> --json
canary improvement recover <sessionId> --apply --session-hash <sessionHash> --lock-hash <lockHash-or-absent> --actor maintainer --reason "Close the interrupted attempt" --config <agent-config> --json
```

`profile` reads current source and selected retained evidence without importing project configuration, running checks or calling an Agent/model. With 1–5 samples, it reports discovery, structure build, evidence verification, quality brief and project-memory lookup durations, scope counts, available identities and explicit blocked/unavailable reasons. Sequential samples describe this workload, not production latency or improvement. The elapsed budget is checked between operations; an ongoing synchronous analysis is not preempted.

`recover` previews ownership and exact session/lock hashes by default. Explicit `--apply` closes only an interrupted ledger whose owner is proven absent; use the returned `lockHash`, including the literal `absent` when no lock exists. Active, unproven, mismatched or changed ownership blocks recovery. It records actor/reason, keeps the attempt consumed and marks its unobserved duration, cases and tool calls unknown. It does not rerun work, establish a repair result or terminate a persisted PID. An interrupted recovery guard is retained for inspection.

Decision and improvement records protect referenced run evidence from retention. Busy, corrupt or changed reference stores block pruning. Session storage is bounded to 64 records; records and source evidence remain intact at the limit. Use reviewed [evidence archive rotation](evidence-archive.md) to retain the complete collection and free active record quotas. Restore preserves the original hashes and charged attempts.

## Retain useful knowledge

[Reviewed project experiences](r8-project-experience.md) already support proposed candidates, regression/holdout trials, approval, activation and rollback. Reusing one requires its evidence and approval flow; context selection, function delivery, actual use and benefit are different observations. [Project repair memory](project-memory.md) retains verified repair facts separately.

`canary improve` writes regression drafts. `canary suggest` writes suggestion state even without a decision flag. Neither is a read-only recommendation preview, and a suggestion's `verified` state is not executed regression proof. Host reasoning can present choices without calling either command.

## Cost and support

The host supplies reasoning and consumes its own model context. Agent execution, live tools or an explicitly configured Judge may incur additional calls; use the chosen provider's conditions and the task's budget. Ordinary project checks and `assess` do not require a model. Unknown token or monetary metrics stay unknown.

Skill packaging, local installation and deterministic Agent fixture execution are testable separately from discovery or behavior in each external host. Supported clients must load the Skill; its instructions alone are not an independently deployed autonomous Agent service.

中文：`assess` 共享质量简报、推荐与选择；`improvement prepare/execute/show` 绑定原始断言、候选身份和累计预算，显式执行后保留配对改善、回归及不确定性。页面与 MCP 只读展示历史。选择、源码修改、候选验证和经验激活分别留痕；缺失费用数据保持未知。
