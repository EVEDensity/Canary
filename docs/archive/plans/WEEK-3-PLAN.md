> **历史档案，非当前规范。** 以下正文保留当时结论/数据；当前能力以[源码审计](../../evidence/code-audit.md)为准，后续安排见[任务目录](../../roadmap/README.md)。归档仅新增本提示、修复导航及规范格式。

# Canary Week 3 Plan

> 焦点：报告、能力用例、改进闭环，并补齐 Adapter / Trace / 历史 UI / Coverage 基准。

## P0

- JSON / Markdown / JUnit reporters，从 artifact 生成；CLI 失败退出码 1。
- 能力用例 ≥ 12：规划、工具、失败恢复、循环停止、禁止工具、步数、终止、上下文隔离。
- Improvement：失败导出建议；baseline vs candidate；回归则 reject；不改用户源码。
- Demo Agent 补 planning / tool-routing / error-recovery / termination 分支。

## P1

- HTTP 黑盒 AgentAdapter：无插桩时 coverage=`unavailable`。
- MCP stdio ToolAdapter，与 AgentAdapter 分离。
- Trace 脱敏、截断、按 type/feature 查询。
- Web 历史 run 列表、case/trajectory 交互、`/report/:format`。
- Coverage `summarizeCoverage` ops/sec 基准测试。
