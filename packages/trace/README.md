# @canary/trace

## 目标

记录 Agent 消息、工具调用、工具返回、状态变化、错误和执行元数据，形成可回放、可脱敏、可关联覆盖率的 Trajectory。

## 边界

- 只采集、校验、脱敏、持久化和查询事件。
- 不负责判断通过/失败，不修改 coverage，不启动 Web Server。
- 事件必须带 runId、executionId、caseId 或可由上下文补齐；大字段必须截断或转 artifact。
