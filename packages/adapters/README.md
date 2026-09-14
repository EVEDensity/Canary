# @canary/adapters

## 目标

把不同 Agent 入口规范化为一个可观测的 AgentAdapter，并把 MCP 工具接入与 Agent 入口分开。

## 边界

- Agent 和 Tool 的接入范围见下文当前说明，不再沿用早期 P0/P1 计划作为能力表。
- `ModelProvider` 是独立模块（`src/model.ts`），契约在 `@canary/core`。它不是 `@canary/evaluators` 的 `JudgeProvider`，也不单独发一个 npm 包。
- 不实现 Runner 生命周期、不计算覆盖率、不拥有评测规则。
- Adapter 必须通过 canary Context 发送可观测事件；绕过 Hook 的调用不承诺可见。
- `@canary/adapters` 仍是 **Canary 作为 MCP 客户端** 调用外部 Agent/工具。可选的 Canary MCP **Server** 在 `@canary/mcp-server`，不在本包。

## 当前接入范围

Agent 路径已有 function/http/mcp（stdio）；工具路径另有 mock/mcp-stdio/mcp-http。简化 MCP Demo 不表示完整协议或任意宿主兼容。Canary 自己的宿主 MCP Server 在 `@canary/mcp-server`，与本客户端路径分开。当前使用方式见[适配器指南](../../docs/guides/adapters-and-environment.md)。
