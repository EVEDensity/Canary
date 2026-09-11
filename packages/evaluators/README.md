# @canary/evaluators

## 目标

在统一输入上运行输出、工具、轨迹、状态、覆盖率和可选 Judge 评测器，返回可解释的 AssertionResult。

## 边界

- 硬门槛优先使用确定性断言；LLM Judge 只能作为可选 evaluator。
- 不启动 Agent、不操作用户源码、不降低用户配置的覆盖率分母。
- evaluator 错误、超时和低置信度必须显式失败或 unavailable，不能默认通过。
