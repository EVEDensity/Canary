# local-agent example

## 目标

提供不依赖外部模型和 API Key 的最小 Agent，被用于验证 canary 的 Adapter、Trace、Coverage、Feature Coverage、失败归因和 UI。

默认套件在仓库根目录 `cases/smoke/`、`cases/regression/`、`cases/holdout/`，由根 `canary.config.ts` 加载。MCP stdio Agent 单独见 `examples/mcp-agent/`。

## 边界

- 该示例只验证评测基础设施，不代表真实模型能力或行业 benchmark 成绩。
- 示例故意包含规划、工具路由、错误恢复和终止分支，供覆盖率 fixture 使用。
