# S-02 冻结范围

## 基线与环境

- 任务：S-02「可选 Canary MCP Server 与协议兼容矩阵」
- 规范：[docs/roadmap/03-host-and-soft-evolution.md](../roadmap/03-host-and-soft-evolution.md#s-02)
- 版本核对：[docs/research/agent-evolution.md](../research/agent-evolution.md)
- 工作协议：[docs/roadmap/00-working-protocol.md](../roadmap/00-working-protocol.md)

## 目标

1. 新增 Canary **服务端** MCP，与现有 adapters 客户端路径分开。
2. 仅暴露 `canary.run` / `canary.evidence` / `canary.submit_proposal`；默认无源码写能力。
3. Dual-era：旧版 `2025-11-25` 走 `initialize` 能力协商；现代 `2026-07-28` 走 per-request `_meta`。未支持版本明确拒绝。
4. 鉴权、输入 Schema、项目绑定、取消、资源限额。
5. 工具参数不能抬升授权。关闭 MCP 后 CLI/Skill 仍可用。

## 非目标

- 不修改 `@canary/adapters`、Runner、H/L 包或 S-01 Skill。
- 不把所有版本强制套入旧初始化。
- 不实现 Sampling，不用 MCP 作为 Judge 核心。
- 不替宿主读取登录凭证或 IDE token。
- 不实现完整 Streamable HTTP 会话生命周期。
- 不宣称全宿主通用 `/canary`。

## 可改路径

- `packages/mcp-server/**`（新建）
- `packages/cli/src/mcp.ts`（新建）
- `packages/cli/src/index.ts` 仅增加 `mcp` 命令分发与 USAGE 行
- `packages/cli/package.json` / `tsconfig.json`、根 `tsconfig*.json` 的包引用
- `docs/evidence/s02-*`、`docs/roadmap/README.md`、`docs/roadmap/03-host-and-soft-evolution.md` 状态、指南中 MCP Server 一句边界

## 验收命令

- `pnpm --filter @canary/mcp-server test`
- `pnpm build`
- `pnpm test`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm demo:headless`
- `pnpm format:check`

## 停止与回滚

- 只实现 S-02。不开始 L-02/L-03，不改硬进化行为。
- 回滚：删除 `@canary/mcp-server` 与 CLI `mcp` 分发；CLI/Skill/adapters 客户端保持原样。
