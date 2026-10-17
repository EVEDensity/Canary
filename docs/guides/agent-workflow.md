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

The user can request assessment only, select a proposed improvement, or authorize bounded host work with allowed scope, success criteria, iterations and call budgets. The shared decision entry records the choice; automatic execution and measured-benefit orchestration are tracked under R30. Existing execution and comparison commands remain available within the task's authorization.

For an authorized function-adapter candidate, retain fixed cases, assertions and independent holdout:

```sh
canary candidate <baselineRunId> --entry <candidate-entry> --config <agent-config> --headless --no-open
canary compare <baselineRunId> <candidateRunId> --config <agent-config>
```

`--entry` replaces a function entry; HTTP/MCP candidates require a reviewed configuration for the selected endpoint/server and comparable rerun evidence. Report paired samples, actual improvements, regressions and uncertainty. Missing trials, incompatible evidence and insufficient samples remain visible. Judge scores require appropriate calibration and cannot override hard gates. Use [project repair verification](repair-verification.md) when proving a project regression; that receipt is distinct from an Agent case comparison.

Stop at success, the agreed budget, changed authorization requirements or an unchanged blocker. Continuous improvement is invoked within the task; recurring monitoring needs a separate user request.

## Retain useful knowledge

[Reviewed project experiences](r8-project-experience.md) already support proposed candidates, regression/holdout trials, approval, activation and rollback. Reusing one requires its evidence and approval flow; context selection, function delivery, actual use and benefit are different observations. [Project repair memory](project-memory.md) retains verified repair facts separately.

`canary improve` writes regression drafts. `canary suggest` writes suggestion state even without a decision flag. Neither is a read-only recommendation preview, and a suggestion's `verified` state is not executed regression proof. Host reasoning can present choices without calling either command.

## Cost and support

The host supplies reasoning and consumes its own model context. Agent execution, live tools or an explicitly configured Judge may incur additional calls; use the chosen provider's conditions and the task's budget. Ordinary project checks and `assess` do not require a model. Unknown token or monetary metrics stay unknown.

Skill packaging, local installation and deterministic Agent fixture execution are testable separately from discovery or behavior in each external host. Supported clients must load the Skill; its instructions alone are not an independently deployed autonomous Agent service.

中文：`canary assess <runId> --json` 只读生成封存证据的质量简报，CLI、MCP 与页面共享问题、推荐和选择记录。页面或显式 `assess decide` 可记录选择/拒绝，但不等于执行或审批；对话无需每次写入状态。规则建议与宿主解释分开，自动执行与收益编排列入 R30。
