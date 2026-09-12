# 当前评估、Judge 与 Coverage

> 依据：[Evaluators](../../packages/evaluators/src/index.ts)、[Core DSL](../../packages/core/src/dsl.ts)、[Coverage](../../packages/coverage/src/index.ts)。

## 确定性评估

已有输出存在 / schema / predicate、工具名称/参数/顺序、状态、事件、执行终止、步数、调用数、延迟、预算、feature 和 coverage 等断言。声明式断言不等于权限控制；特别是预算来自可获得的事件/指标，不代表已强制限制付费模型账单。

运行结束时 CLI 合并 coverage gate 与 hard gate，并结合运行状态和 JUnit 失败计算退出码。当前 hard gate 关注非预期 policy/loop、失败 state 断言及配置 feature 的 unavailable。负向用例可显式预期某些事件；这些测试语义不能作为未来生产操作的权限例外。

## Judge：显式配置，缺失即失败

- 已有 JudgeProvider、HttpJudgeProvider、DeterministicJudgeProvider，以及 `judge.score` 断言。
- 配置 `judge.provider`（`http` 需 `allowOutbound: true` 与 `url`）由 Runner 注入。未配置时，必需的 `judge.score` 失败；`required: false` 为 skipped。
- DeterministicJudge 是测试桩，必须显式 `verdict`/`score`，不能把“输出存在”当成语义评分。
- HTTP Judge 超时会 abort 请求，并对 input/output 做密钥字段脱敏。
- `decideAdmission` 与 compare verdict 分离：高 Judge 分不能抵消 hard gate；质量不确定时 admission 为 `hold`，不是自动批准。

## Coverage 的含义

Coverage 是本地源码单元/范围命中，不是模型理解、任务正确性或安全性分数；与断言、语义评审分别展示。

- V8 是默认路径，可选择 Istanbul instrumentation。源码映射的 approximate 与 AST instrumentation 的 exact 是不同精度，不可笼统称全部“精确”或全部“不精确”。
- include 中未执行的可分析文件可进入分母并显示 0 命中；HTTP/MCP 黑盒没有采集能力则为 unavailable。
- unavailable 的旧对象仍有数值占位字段（例如 pct=0）；应按 status 解读。compare 在 coverage 非 final 或分母不同时标记 `coverageDelta.comparable: false`，不再用 0 隐藏缺口。
- 配置 features 的 id/files，并通过 coverage 的 feature 包装和用例 expectedFeatures/coverage 断言关联事件与源范围。
- 当前 feature-chain gate 明确 `source_pct`、`partialDoesNotFail: true`；partial 不因状态本身失败，但仍需满足阈值。不可把这一规则泛化为“所有 partial coverage 都允许”。
- sourceHash、mappingMode、precision 和 diagnostics 应一起解释；缺失或近似映射不应包装成确定性语义质量。

覆盖率 fixture 是当前 `vitest run` 会运行的测试；CI 另有单独 fixture job 重复验证，并非默认测试不包含它。
