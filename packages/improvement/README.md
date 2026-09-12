# @canary/improvement

当前提供失败归因、建议状态迁移、回归草稿和运行比较。**不生成或应用 Agent 源码补丁，不提供可信自动发布门禁。**

## 使用与边界

完整命令见[当前 improvement 指南](../../docs/guides/improvement.md)。`suggest --accept/--reject/--verify` 改变建议状态；`verified` 不证明独立验证通过。`improve` 也可以导出草稿，因此不能概括成“只有 verified 才能写出草稿”。

当前草稿可能丢失断言参数或用 output 兜底 input，需要人工对照原 case；holdout 按 ID 字符串识别，不构成隐藏集保护；compare 会覆盖同 caseId 的 repetitions，且缺失候选结果可能未被判退化。请勿据其 verdict 自动修改项目。

源码缺口见[审计](../../docs/evidence/code-audit.md)，修补任务见[Q 系列](../../docs/roadmap/02-evaluation-integrity.md)。未来受控软/硬进化是[设计目标](../../docs/design/agent-loop.md)，尚未实现。
