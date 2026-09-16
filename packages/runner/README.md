# @canary/runner

## 目标

编排一个 Test Case 的完整 execution 生命周期：Agent Adapter、工具环境、Trace、Coverage、Evaluator 和报告。

## 边界

- 负责生命周期、超时、步数、取消、重试策略和 execution ID。
- 不实现 Agent 业务逻辑、不实现 Coverage 算法、不渲染 Web UI。
- 每个 execution 默认隔离资源；子进程与临时目录必须由 Runner 负责清理。

## 当前实现注意

Node worker 有统一的超时、取消、预算终止、IPC 校验和进程树清理，并为每次运行隔离 tmp/work/env/port/lock；子进程仍继承宿主权限，**不是文件/网络安全沙箱**。崩溃后可从 `checkpoint.json` 读取 partial run 并收尾，不会覆盖已完成结果。HTTP/MCP 把 `AbortSignal` 映射为 timeout/cancelled。见[当前架构](../../docs/current/architecture.md)与 [R1 路线图](../../docs/roadmap/06-personal-production-test-roadmap.md)。
