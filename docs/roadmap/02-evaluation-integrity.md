# Q：评估可信度与准入门禁

> 历史参考：本文件不再是待执行清单。后续唯一基线为 [个人开发者路线图](06-personal-production-test-roadmap.md)，当时的“已实施”不代表 R0–R8 已完成。

> Q-01 到 Q-04 已落地到当前代码。compare 的 `improve` 与 suggestion 的 `verified` 仍不是安全证明或发布许可。

<a id="q-01"></a>

## Q-01 · 比较完整性、repetitions 与候选退出码

- **依据/范围**：`packages/improvement/src/index.ts` 按 caseId 建 Map 导致多 trial 覆盖，缺失的通过用例不会被算退化；`packages/cli/src/index.ts` candidate 判定没有可靠合并本次执行失败状态。
- **交付**：冻结预期 case × trial 清单、唯一 ID、完成状态；基线/候选可比性检查；缺测、取消、错误、退出码和不可用指标的明确状态；完整性失败不能进入 improve/keep 准入。
- **验收**：加入缺失 baseline passing case、重复结果 ID、先失败后成功两个 trial、候选崩溃/超时但局部有改善、不同配置/数据版本、缺 coverage 等反例；不得通过最后一个 trial 或默认 0 隐藏问题。
- **依赖/回滚**：无，可小步修补；保留报告读取兼容，旧不完整报告标不可判定，不能沿用旧不安全通过语义。
- **排除**：本任务不自动承诺统计显著性；统计方法由 Q-04 定义。

<a id="q-02"></a>

## Q-02 · Judge 的显式来源、缺失语义和生命周期

- **依据/范围**：`packages/evaluators/src/index.ts` 有 HttpJudgeProvider，但 Runner/CLI 未注入真实 Judge；默认 DeterministicJudgeProvider 对存在输出可给 score/confidence 1。超时 Promise.race 不会自动取消 fetch。
- **交付**：从配置→组合根→Evaluator 的显式 Provider；deterministic test stub 与语义 Judge 区别；required/optional 状态；版本/rubric/置信度/成本来源；外发同意、脱敏、超时与取消。
- **验收**：无 Key/无 Provider 的必需 Judge 阻断，可选维度 skipped/unavailable；不把 stub 当语义评分；API 错误、低置信度、格式错误、超时/取消和隐藏注入样本；无授权无外发；测试真实请求是否终止而非只停止等待。
- **依赖/回滚**：无，后续可迁入 F-05 端口；迁移说明旧默认行为变更，不恢复“未评却通过”。
- **排除**：自动读取 IDE 私有 token、自动下载/启动模型；MCP Sampling 不作为新实现前提。

<a id="q-03"></a>

## Q-03 · 回归草稿与数据集身份

- **依据/范围**：improvement 的 proposedCase 丢失 assertion operands，input 可回退到 output，草稿可降为 output.exists；holdout 只按 ID 字符串判断。
- **交付**：可靠的原始 case 引用、完整输入/断言/前置状态；无法恢复时标不可生成，不伪造 Case；草稿审核与真实验证分离；显式数据集 split/版本/内容哈希，受保护保留集边界。
- **验收**：tool.args、schema、状态、predicate 等断言往返不失真；不可序列化内容明确拒绝；tag/ID 不一致不能误判 holdout；提案进程无法读取或修改隐藏答案；accepted/verified 不替代执行证据。
- **依赖/回滚**：核心修复无前置，集成 Q-01 的试验账本；保留原建议证据，不自动覆盖用户 regression 文件。
- **排除**：自动用模型生成“更容易通过”的期望值、迁移历史数据时重写其结论。

<a id="q-04"></a>

## Q-04 · 注册器、指标质量与独立准入

- **依据/范围**：evaluators 固定 dispatcher；coverage 有 approximate/exact/unavailable 等区别；当前 compare 主要看 pass 转移，没有完整实验统计与安全准入。
- **交付 A（兼容重构）**：Evaluator registry/descriptor，旧入口包装器，能力/成本/数据要求可声明；不改变原断言语义。
- **交付 B（行为升级）**：Metric 的 value/status/precision/provenance；硬门禁与质量目标分离；固定阈值、重复试验方案和可解释决策；独立评估器持有受保护数据；近期基线 + 固定锚点。
- **验收**：缺测不能用 0 比较；不同覆盖率分母/collector 不直接排名；高 Judge 分不能抵消安全/状态失败；负例“预期违规”不能绕过实际策略；质量差异不确定时不自动批准；小样本和多次试探策略有明确限制。
- **依赖/回滚**：Q-01/02/03、F-03；A 可先独立实施。新决策保留版本，旧报告不追溯性改判。
- **排除**：固定 70/30 权重、用一次成功保证任意任务长期单调进步。
