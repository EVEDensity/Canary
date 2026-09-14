# S-02 协议兼容矩阵

> 锁定本次实现所支持的版本。不是对任意 MCP 宿主或完整 Streamable HTTP 的认证。核对依据：[研究资料](../research/agent-evolution.md) 与 [2026-07-28 Versioning](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)。

## 支持面

| 维度     | 本次支持                                                           | 明确不支持                                      |
| -------- | ------------------------------------------------------------------ | ----------------------------------------------- |
| 协议     | `2025-11-25`（legacy initialize）与 `2026-07-28`（modern `_meta`） | 更早或未列出的日期；把现代请求套进 initialize   |
| 传输     | stdio 换行 JSON-RPC；进程内 handle（测试）                         | 完整 Streamable HTTP session / 已弃用 HTTP+SSE  |
| 服务角色 | Canary MCP **Server**（宿主调用 Canary）                           | 现有 adapters 客户端不因此变成完整协议客户端    |
| 工具     | `canary.run`、`canary.evidence`、`canary.submit_proposal`          | 写源码、apply、push、读取宿主凭证、Sampling     |
| 宿主     | 实现 dual-era 的 stdio 客户端；本仓库测试客户端已实测              | 未单独实测的 Cursor/Claude/Codex MCP 连接字符串 |
| SDK      | `@canary/mcp-server` 0.1 dual-era 实现                             | 不以官方 TS SDK 作为运行时硬依赖                |

## 时代组合（对 Canary dual-era server）

| 客户端     | 预期                                                                    |
| ---------- | ----------------------------------------------------------------------- |
| Modern     | `server/discover` 可选；带 `_meta` 的请求按条接受或 `-32022`            |
| Legacy     | `initialize` → `notifications/initialized` → tools                      |
| 未支持版本 | `-32022 UnsupportedProtocolVersionError`，`data.supported` 列出上述两版 |
| 畸形包     | JSON-RPC parse/invalid request 错误，不进入工具                         |

## 安全

- 服务绑定启动时的 `ProjectContext`；工具参数中的 `projectRoot` / `mode` / `write` 不能改绑定或抬权。
- 需要配置启动 token；工具参数里的 `token` / 凭证字段被拒绝，不能抬升授权。
- 提案结果仍是 `recorded_unapproved` / `not_approved`。
