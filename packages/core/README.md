# @canary/core

## 目标

提供 canary 的稳定领域契约：配置、Test Case、Trajectory、CoverageSummary 和 EvalResult。所有其他模块依赖这些契约，而不是相互读取内部实现。

## 边界

- 只定义类型、轻量工厂和跨模块契约。
- 不启动 Agent、不执行文件系统操作、不采集覆盖率、不提供 HTTP 服务。
- 任何运行时输入校验应在边界 Adapter 中完成；未来可在此包补充 Zod schemas。
