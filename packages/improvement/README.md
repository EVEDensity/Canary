# @canary/improvement

## 目标

根据失败断言、Trace、状态差异和覆盖率缺口生成有证据的改进建议与回归 Case 草稿。

## 边界

- MVP 只提议，不自动修改用户源码、Prompt 或生产配置。
- 改进必须在 regression 和 holdout 上重新验证；建议不能修改自己的评测门槛。
- 外发模型前必须经过脱敏；Suggestion 必须保存证据引用和状态。
