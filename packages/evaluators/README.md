# @canary/evaluators

## 目标

在统一输入上运行输出、工具、轨迹、状态、覆盖率和可选 Judge 评测器，返回可解释的 AssertionResult。

## 边界

- 硬门槛优先使用确定性断言；LLM Judge 只能作为可选 `judge.score` evaluator，且必须在配置中显式提供 Provider。
- 缺少必需 Judge 时断言失败（fail closed）；`required: false` 记为 skipped，不是语义通过。
- DeterministicJudgeProvider 是测试桩，未显式 verdict 时不再给“有输出即 1 分”。
- HTTP Judge 需要 `judge.allowOutbound: true`，超时会 abort fetch，并对 payload 做密钥脱敏。
- `EvaluatorRegistry` 包装原有 `evaluateAgent` 入口，不改变断言语义。
- `decideAdmission` 是独立准入：compare 的 improve/keep 不会自动 admit。
- `coverage.atLeast` 比较该次 execution 的 feature 源码命中百分比。
- Feature-chain gate 冻结为 `FEATURE_CHAIN_GATE_SEMANTICS`：`mode: "source_pct"`，`partialDoesNotFail: true`。
- 不启动 Agent、不操作用户源码、不降低用户配置的覆盖率分母。

## 当前实现注意

`judge.score` 不再回退到“有输出即通过”的 stub。CLI/Runner 从 `canary.config.ts` 的 `judge` 字段注入 Provider。详细现状见[评估指南](../../docs/guides/evaluation-and-coverage.md)。
