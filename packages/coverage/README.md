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
