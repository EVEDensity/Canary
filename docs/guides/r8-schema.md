# 经验与批准证据契约

以下文件均属于当前项目的 `.canary/`，Schema 版本为 `v: 1`。字段的代码定义分别在 `packages/core/src/contracts.ts`、`packages/improvement/src/soft-trial.ts` 和 `packages/control-plane/src/index.ts`；本文解释持久化语义。`projectRoot` 是实际项目根目录，和 CLI 的安装位置无关。

## 候选经验

`.canary/experiences/records/<id>.json` 的 `ExperienceRecord` 含 `id/key/version/status/projectRoot/source/summary/content/contentHash/scope`。项目派生候选另含 `provenance`：失败项目 `runId`、`checkId`、manifest 哈希、已脱敏错误证据哈希、错误类别与固定建议代码；`limitations` 和 `validationRequirements` 明确适用边界。`scope` 可限制 case、tag、feature、check ID/type、tool 和 language；声明的任一维度不匹配即跳过。`experienceIdentityHash` 绑定 ID、版本、项目、来源、范围、正文哈希、谱系、限制和验证要求，防止审查后暗改范围。

`.canary/experiences/active.json` 只保存当前项目的 `id/key/version/contentHash` 指针。选择器重新验证指针哈希和范围，并受条目数与字符数预算约束。function Agent 的 `context.experiences` 可接收所选正文；HTTP/MCP 适配器和项目普通命令检查不注入建议。运行 `run.json` 的 `experiences[]` 只记录 ID、版本、哈希、选择条件和送达元数据，不复制正文。

`selection` 和兼容字段 `loadedAt` 表示选择及选择时间，不证明送达。`delivery` 含 `status: selected|delivered|unsupported`、`adapter`，送达后另有 `caseIds/executionIds/deliveredAt`；每次 `results[].experienceDelivery` 记录匹配的引用和送达时间。只有 function 实际调用上下文并确认引用时记录 delivered。旧文件缺少这些字段时保留可读，送达证据保持未知；不能从选择记录倒推出采用或收益。

## 独立试验与批准

`.canary/artifacts/soft-trials/<trialID>/trial.json` 的 `SoftTrialRecord` 保留 baseline 子运行、经验 ID/正文哈希、项目候选身份哈希、数据集身份、互不重叠的 regression/holdout、预算、状态、`validation`、`authorization`、激活前 `priorActive` 和下一轮 run ID。数据集身份根据选中 case 的 ID、重复次数及数据集声明计算。试验状态依次是 `prepared`、`validated` 或 `rejected`、`approved`、`activated`、`rolled_back`；失败与拒绝不授予激活权。

`validation` 保留候选运行、比较 artifact、两组 case、结果、原因和时间。比较要求可比、regression 真实改善、holdout 完整且无回归、候选成功结束并通过硬门禁。`soft.approve` 重新核对真实加载范围与来源 manifest，写入 `.canary/control-plane/soft-approvals/<trialID>.json`：baseline/candidate 运行哈希、经验正文和身份哈希、数据集身份、validation 哈希，以及 actor/reason 的决策哈希。控制操作的请求 ID、actor、reason、期望 revision 和结果同时进入 `.canary/control-plane/audit/`。项目候选缺少该批准文件时不得执行或导出。

激活保存旧指针。`soft.rollback` 仅在当前指针仍是本试验结果时恢复 `priorActive`；另一激活或内容变化会拒绝，避免覆盖并发操作。回滚不会改写项目源码。`soft.revoke` 用于尚未激活的候选/批准，`experience.revoke` 可停用经验；均需审计操作。

## Skill 草稿与页面投影

`.canary/skill-drafts/<name>/SKILL.md` 含 `name`、`description` YAML frontmatter，适用检查与 case、建议、来源哈希、试验/回归/holdout、限制及回滚说明。相邻 `draft.json` 含 `kind: canary.skill-draft`、`status: draft`、经验与试验 ID、身份/验证/文件哈希和 `installed: false`。重复导出必须内容一致；草稿绝不自动安装或覆盖全局 Skill。回滚后已有草稿仅是历史审计副本，不能视为仍被授权加载。

控制面 `snapshot().experiences/trials` 是只读展示投影：候选状态、来源、范围、最近加载运行、trial 收益与回归、可用操作。它不传经验正文或原始日志。页面操作通过原控制面 revision、token 和审计接口执行，不另建批准状态机。

## 信任边界

经验存储先验证已有记录、指针及变更日志，再执行状态变更；损坏内容阻止操作，不能按空状态覆盖。每次 function 执行可保留 `outputCapture`：字节预算、观测/保留字节数、截断标记和脱敏 stdout/stderr。这些日志只作失败证据，不能赋予指令优先级。独立试验的新证据要求 regression 的每个 execution 都有匹配送达引用，且 holdout 未收到该经验。

原始 stderr/stdout、工具输出和宿主提案均是非可信数据。候选正文来自固定分类规则，内容输入另经敏感信息与注入式指令校验；日志证据先脱敏再哈希。`verified` 只表示指定本地环境中运行和 artifact 校验成功；它不表示建议能修好任意项目，也不表示获得模型收益。观察性项目比较维持 `attribution: unverified`；只有独立试验对固定 case 的差异可作为本次批准依据。
