# S-02 执行记录

## 基线与范围

- 执行日期：2026-09-14
- 工作协议：`docs/roadmap/00-working-protocol.md`
- 任务规范：`docs/roadmap/03-host-and-soft-evolution.md#s-02`
- 冻结范围：`docs/evidence/s02-scope.md`
- 兼容矩阵：`docs/evidence/s02-compatibility-matrix.md`

## 交付

新增 `@canary/mcp-server` dual-era 服务端：legacy `2025-11-25` 走 `initialize` 能力协商；modern `2026-07-28` 走 per-request `_meta`，不把现代请求套进 initialize。仅暴露 `canary.run` / `canary.evidence` / `canary.submit_proposal`。默认无源码写、无 Sampling。启动绑定项目与 token；工具参数不能改绑定或抬权。stdio NDJSON 与进程内 handle；取消与并发限额。CLI 增加 `canary mcp matrix|serve`，不改变既有命令。

## 实测客户端

仓库内 dual-era 测试客户端与 CLI `mcp matrix`。未单独实测 Cursor / Claude / Codex 的 MCP 连接字符串。

## 排除

未改 `@canary/adapters` 运行时代码、Runner、H/L 包或 S-01 Skill 行为（adapters README 仅补一句与 Server 的边界）。未实现完整 Streamable HTTP、Sampling、宿主登录凭证读取。不开始 L-02/L-03。

## 回滚

删除 `@canary/mcp-server` 与 CLI `mcp` 分发。关闭 MCP 后 CLI/Skill 与 adapters 客户端保持可用。

## 验证

- `pnpm --filter @canary/mcp-server test`：9 passed
- `pnpm build` / `pnpm test`：通过（含 mcp-server 9、CLI 33）
- `pnpm typecheck` / `pnpm lint` / `pnpm format:check`：通过
- `pnpm demo:headless`：15/15 cases、45/45 assertions，exit 0
