# L-03 分发与可选导出指南

## 原则

L-03 不改变本地优先：exporter 默认关闭，不配置 endpoint 不产生网络请求；本地 artifacts 始终是评估真相源。

## 分发

- 声明环境：Node.js >=22，pnpm 10.15.0；源码 checkout 安装。
- 安装根由 `~/.canary/home.json` 注册，项目根由当前目录或 `--config` 解析，两者不混用。
- Windows 使用 `scripts/install/install.ps1`，macOS/Linux 使用 `scripts/install/install.sh`。
- 升级前应保证 checkout 干净；离线时安装/升级清晰失败且不注册半成品 launcher。
- `scripts/install/uninstall.ps1`、`scripts/install/uninstall.sh` 只移除 Canary launcher、注册信息和 Canary 自己写入的 PATH 项，不删除项目 `.canary` 或导出文件。

## 导出

`canary export --out export.json [--format json|ndjson] [--run <id>]` 仅写本地文件。导出内容是运行摘要；input/output/trajectory/holdout/source/diff/path 和凭证均剔除。覆盖写入被拒绝（`wx`）。

`packages/exporter-core` 提供用户主动启用的 HTTPS transport contract、OTLP/Phoenix/Langfuse endpoint 映射、批量/字节/速率限制、超时、重试和 degraded 状态。当前不是完整 OTLP protobuf/标准 JSON、Phoenix 或 Langfuse schema 互操作实现，不能据此宣称第三方平台已完全接通。

## 验收边界

外部服务失败只影响 exporter health，不阻断本地评估；不得发送原始项目内容、保留集或凭证。真实跨平台清洁环境和第三方协议互操作仍是后续工作。
