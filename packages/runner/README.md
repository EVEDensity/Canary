# @canary/runner

## 目标

编排一个 Test Case 的完整 execution 生命周期：Agent Adapter、工具环境、Trace、Coverage、Evaluator 和报告。

## 边界

- 负责生命周期、超时、步数、取消、重试策略和 execution ID。
- 不实现 Agent 业务逻辑、不实现 Coverage 算法、不渲染 Web UI。
- 每个 execution 默认隔离资源；子进程与临时目录必须由 Runner 负责清理。

## 当前实现注意

Node worker 有超时、取消、IPC 校验和进程树清理，但继承宿主环境权限，**不是文件/网络安全沙箱**。HTTP/MCP 的取消和资源管理尚未与本地执行统一；当前 Runner 直接组装部分适配器/评估/覆盖率实现。上面的“隔离资源”是生命周期目标，不是自动硬进化的安全保证。见[当前架构](../../docs/current/architecture.md)与[F-05 / H-01 任务](../../docs/roadmap/README.md)。
