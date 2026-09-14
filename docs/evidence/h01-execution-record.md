# H-01 执行记录

## 基线与范围

- 执行日期：2026-09-14
- 工作协议：`docs/roadmap/00-working-protocol.md`
- 任务规范：`docs/roadmap/04-controlled-hard-evolution.md#h-01`
- 威胁模型：`docs/evidence/h01-threat-model.md`
- 冻结范围：`docs/evidence/h01-scope.md`

## 目标与非目标

H-01 交付外置策略、授权/预算账本、受控工具/网络代理，以及按平台可验证的 userspace 隔离。默认 `canary run` 仍评估受信项目 Agent，不把普通 Node 子进程宣称为 OS 沙箱。隔离缺失时自动硬写 fail closed。

本次在同一工作区继续实现 H-02/H-03/L-01，但 H-01 验收只覆盖策略、隔离与 POL-01/02/03/05/06/07/09 拒绝证据。

## 变更路径

- `packages/policy/**`
- `packages/isolation/**`
- `packages/runner/src/index.ts`（可选 isolation 请求；默认路径不变）
- `packages/environment/src/index.ts`（声明 `externalRollback=unsupported`）
- `packages/core/src/contracts.ts`（authorization 接线）
- `packages/cli/src/index.ts`（`isolation probe` / `policy show`）

## 进程边界

- 沙箱外：CLI、策略引擎、授权/预算账本、隔离监督器、评估比较。
- 沙箱内：带 preload 的候选 worker、候选发起的网络/工具。
- 不是沙箱：worktree、无 preload 的 Node 子进程、MCP 提示、`MemoryStateStore.restore`。

## 回滚

删除 `@canary/policy` 与 `@canary/isolation`，去掉 runner 的 isolation 分支。禁用隔离后只保留受信人工建议，不能退回无隔离自动写。

## 验证

- `pnpm build`：通过
- `pnpm test`：通过（含 policy 8、isolation 5、hard-evolution 6、loop 4、CLI 31）
- `pnpm typecheck` / `pnpm lint` / `pnpm format:check` / `pnpm demo:headless`（15/15 cases、45/45 assertions）：通过
