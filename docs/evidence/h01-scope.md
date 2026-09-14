# H-01 冻结范围

## 基线与环境

- 工作区：Windows / Node `v24.18.0` / pnpm `10.15.0`
- 任务：H-01「外置策略、最小权限与真实隔离」
- 规范：[docs/roadmap/04-controlled-hard-evolution.md](../roadmap/04-controlled-hard-evolution.md#h-01)、[docs/design/evolution-policy.md](../design/evolution-policy.md)
- 工作协议：[docs/roadmap/00-working-protocol.md](../roadmap/00-working-protocol.md)

## 目标

1. 外置、版本化策略与授权记录，候选进程不能改写。
2. 按平台可验证的文件、网络、进程隔离；环境变量 allowlist。
3. 独立只读策略/评估数据；授权与预算账本；受控工具代理。
4. 沙箱能力缺失时 fail closed；禁用隔离后只保留受信人工建议，不能退回无隔离自动写。
5. 逐项拒绝 POL-01/02/03/05/06/07/09，并留下路径穿越、链接越界、未授权网络/工具、环境密钥、恶意 config/predicate、后台子进程、并发预算绕过的证据。
6. 明确哪些进程在沙箱内、哪些在外。见[威胁模型](h01-threat-model.md)。

## 非目标

- 不把 worktree、Node 子进程或 MCP 权限提示宣称为 OS 安全边界。
- 不实现 H-02 候选工作区、H-03 源码应用、L-01 持续循环（可在本包之后立即开始，但不并入 H-01 验收）。
- 不改变默认 `canary run` 对受信项目 Agent 的评估路径；默认评估不是自动硬进化。
- 不发布 npm/二进制，不引入云沙箱硬依赖。

## 可改路径

- `packages/core/src/contracts.ts`
- `packages/policy/**`（新建）
- `packages/isolation/**`（新建）
- `packages/environment/**`、`packages/adapters/**`、`packages/runner/**`
- `packages/cli/src/**`、相关测试
- `docs/evidence/**`、`docs/roadmap/README.md`

## 验收命令

- `pnpm build`
- `pnpm --filter @canary/policy --filter @canary/isolation test`
- `pnpm test`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm demo:headless`
- `pnpm format:check`

## 停止条件与回滚

- H-01 完成后才开放 H-02。
- 隔离不可用时拒绝自动写，不得静默降级。
- 回滚时删除本任务新增的 policy/isolation 包和 CLI 接线；默认评估行为应可恢复。
