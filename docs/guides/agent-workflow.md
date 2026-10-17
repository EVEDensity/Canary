# Agent assessment and guided improvement

Canary brings Agent execution, tool assertions, traces, source coverage, replay and version comparison into one improvement workflow. The official Skill helps a compatible host explain the results, recommend next steps and verify the user's selected action. The CLI and MCP provide execution and retained evidence.

## Ask for an assessment

Install or update the official project Skill with `canary skill install` or `canary skill update`. In a host that has loaded it, ask:

> Assess this Agent using its existing cases. Explain the main failures, recommend a next step and offer alternatives before changing source.

The Skill first identifies the project, Agent configuration, case set and available evidence. A matching retained run can be analyzed without another Agent execution. For a new assessment:

```sh
canary run --ci --config <agent-config>
canary host evidence <runId> --max-cases 8 --max-events 20 --config <agent-config>
```

Select the Agent configuration explicitly when a project also contains project-check configuration. Automatic script discovery verifies existing project checks; Agent behavior needs an adapter and meaningful cases. If these are missing, the host can propose an adapter/case draft for review, with the required execution conditions.

## Understand the result and choose an action

A useful quality brief contains:

- The tested Agent version, run/case identities, selected scope and actual result counts.
- Observed task/output failures, tool selection/arguments/order, state or termination failures, environment blockers and verification gaps.
- Source or trajectory references, and a clear distinction between an observation and a root-cause hypothesis.
- A recommended next action with its reason, proposed change scope, expected benefit and validation plan; alternatives when there is a real tradeoff.

For example, a retained wrong-tool assertion may support correcting tool routing, reviewing an ambiguous behavior contract or inspecting the matching trace first. This is an interaction example, not a claimed project failure. The recommendation depends on the actual contract and evidence; it must not silently weaken the assertion.

The host can offer choices in conversation using its available interaction UI. This release does not add a persisted decision-card schema or new workspace approval buttons. Existing approval controls retain their current meaning.

## Execute and compare

The user can request assessment only, select a proposed improvement, or authorize bounded automatic work with allowed scope, success criteria, iterations and call budgets. Existing authorization carries forward; a selected plan does not confer new credential, network or publication access.

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

The host supplies reasoning and consumes its own model context. Agent execution, live tools or an explicitly configured Judge may incur additional calls; use the chosen provider's conditions and the task's budget. Ordinary project checks do not require a model. Unknown token or monetary metrics stay unknown.

Skill packaging, local installation and deterministic Agent fixture execution are testable separately from discovery or behavior in each external host. Supported clients must load the Skill; its instructions alone are not an independently deployed autonomous Agent service.

中文：Canary 面向 Agent 评测与持续改进，串联真实运行、工具校验、轨迹、覆盖率、回放和版本比较。官方 Skill 让宿主按证据说明问题、给出推荐和可选方案，随后在授权范围内执行并验证。当前交互通过宿主对话完成；统一决策数据与页面入口列入后续路线，不宣称已实现无人值守优化或普遍的质量收益。
