# @canary/environment

## 目标

提供 Mock Tool、Mock HTTP、内存状态、快照/恢复和故障注入，帮助 Agent 测试在低成本、可复现环境中执行。

## 边界

- 不连接真实生产服务，除非用户显式配置。
- 不提供安全沙盒；Agent/工具进程仍需外部沙盒保护不可信代码。
- 每个 execution 应拥有独立实例，并在 finally 阶段 reset/cleanup。
