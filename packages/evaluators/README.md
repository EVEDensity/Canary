# @canary/evaluators

## 目标

在统一输入上运行输出、工具、轨迹、状态、覆盖率和可选 Judge 评测器，返回可解释的 AssertionResult。

## 边界

- 硬门槛优先使用确定性断言；LLM Judge 只能作为可选 `judge.score` evaluator。
- Judge 错误、超时和低置信度必须显式失败，不能默认通过。
- `coverage.atLeast` 比较该次 execution 的 feature 源码命中百分比。
- Feature-chain gate 冻结为 `FEATURE_CHAIN_GATE_SEMANTICS`：`mode: "source_pct"`，`partialDoesNotFail: true`。
- 不启动 Agent、不操作用户源码、不降低用户配置的覆盖率分母。

## 当前实现注意

`judge.score` 未注入 Provider 时会回退到 DeterministicJudgeProvider，主要判断输出存在；这不是语义 Judge，也不是缺少必需 Judge 已 fail closed。CLI/Runner 尚未接通真实 Judge 配置。已有显式错误/低置信度/超时失败分支，但超时不保证取消上游请求。详细现状与后续修复见[评估指南](../../docs/guides/evaluation-and-coverage.md)和[Q 系列任务](../../docs/roadmap/02-evaluation-integrity.md)。
