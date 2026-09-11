# @canary/reporters

## 目标

把 Run/Eval/Coverage 数据输出为 Console、JSON、Markdown、JUnit 和未来的 HTML/外部 Trace 格式。

## 边界

- Reporters 只消费稳定数据契约；不重新计算指标、不执行 Agent、不影响测试结果。
- JSON 是机器可读事实源；Markdown 是人读摘要；JUnit 只反映质量门槛结果。
