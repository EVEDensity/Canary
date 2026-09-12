# @canary/coverage

## 目标

采集并合并被测 Node/TypeScript Agent 的运行时代码覆盖率，映射到源码和 canary Feature Registry，向 Runner 与 Web UI 提供统一 CoverageSummary。

## 边界

- 只负责 CoverageProvider、Source Map、manifest、fragment 去重与聚合。
- v0.1 source-map 精度冻结为 `approximate`（`SOURCE_MAP_PRECISION`）。
- 不判断 Agent 行为是否正确，不执行 Test Case，不修改用户源码。
- MVP 以 Node/V8 为 P0；远程黑盒 Agent 无法自动获得源码覆盖率时必须返回 `unavailable`，不得伪造数值。
- 覆盖率变更必须用现有 fixture 验证分支、函数、异常路径、未加载文件和重复 fragment。

## 当前精度与验证

默认 V8 source-map 路径标记 approximate；另外已有 Istanbul AST instrumentation 的 exact 路径，不能将本包所有输出一律视为 approximate。Coverage fixture 已存在且包含在默认包测试中。unavailable 对象中的旧数值占位字段不代表测量值。见[评估与覆盖率指南](../../docs/guides/evaluation-and-coverage.md)及[本轮验证](../../docs/evidence/validation-baseline.md)。
