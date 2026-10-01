# @canary/runner

## 目标

编排一个 Test Case 的完整 execution 生命周期：Agent Adapter、工具环境、Trace、Coverage、Evaluator 和报告。

## 边界

- 负责生命周期、超时、步数、取消、重试策略和 execution ID。
- 不实现 Agent 业务逻辑、不实现 Coverage 算法、不渲染 Web UI。
- 每个 execution 默认隔离资源；子进程与临时目录必须由 Runner 负责清理。

## 当前实现注意
