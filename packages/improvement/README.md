# @canary/improvement

## 目标

根据失败断言、Trace、状态差异和覆盖率缺口生成有证据的改进建议与回归 Case 草稿。

## 失败归因

`attributeFailure` 将失败分为：wrong output/tool/arguments、schema error、unrecovered error、loop、timeout、state mismatch、coverage gap、policy violation。每条建议带 evidence（assertion / trace / state / coverage）和 `kind`。

## 批准流

`proposed → accepted | rejected → verified`。CLI：

```bash
canary suggest <runId>
canary suggest <runId> --accept <suggestionId>
canary suggest <runId> --verify <suggestionId>
canary candidate <baselineRunId> --entry ./fixed-agent.mjs --headless
```

只有 `verified` 写入默认 `cases/regression/`。端到端演示见 `examples/improvement-demo/`。

## 边界

- MVP 只提议，不自动修改用户源码、Prompt 或生产配置。
- 改进必须在 regression 和 holdout 上重新验证；建议不能修改自己的评测门槛。
- 外发模型前必须经过脱敏；Suggestion 必须保存证据引用和状态。
- 硬门槛：policy violations = 0，unexpected loops = 0，state assertions = 100%，核心 feature 不得 unavailable。
