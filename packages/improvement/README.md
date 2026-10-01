# @canary/improvement

当前提供失败归因、建议状态迁移、回归草稿和运行比较。**不生成或应用 Agent 源码补丁，不提供可信自动发布门禁。**

## 使用与边界

完整命令见[当前 improvement 指南](../../docs/guides/improvement.md)。`suggest --accept/--reject/--verify` 改变建议状态；`verified` 不证明独立验证通过。`improve` 也可以导出草稿，因此不能概括成“只有 verified 才能写出草稿”。

草稿在无法序列化原断言或缺少原始 input 时标记 `generation.unavailable`，不会用 output 伪造 Case。holdout 只认 `tags: ["holdout"]` 或 `dataset.split: "holdout"`。compare 按 case×trial 对账；`admission` 与 `verdict` 分离，improve 不是发布许可。
