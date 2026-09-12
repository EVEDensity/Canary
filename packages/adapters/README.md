# @canary/adapters

## 目标

把不同 Agent 入口规范化为一个可观测的 AgentAdapter，并把 MCP 工具接入与 Agent 入口分开。

## 边界

- P0：本地 Function Adapter；P1：HTTP；工具侧可接 MCP stdio。
- `ModelProvider` 是独立模块（`src/model.ts`），契约在 `@canary/core`。它不是 `@canary/evaluators` 的 `JudgeProvider`，也不单独发一个 npm 包。
- 不实现 Runner 生命周期、不计算覆盖率、不拥有评测规则。
- Adapter 必须通过 canary Context 发送可观测事件；绕过 Hook 的调用不承诺可见。
