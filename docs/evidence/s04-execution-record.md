# S-04 执行记录

## 基线与范围

- 执行日期：2026-09-13
- 工作区：Windows / Node `v24.18.0` / pnpm `10.15.0`
- 基线 commit（仅作记录，不回退工作区）：`39c34e717d71e30ecd0afc8efda8605cb3018bec`
- 工作协议：`docs/roadmap/00-working-protocol.md`
- 任务规范：`docs/roadmap/03-host-and-soft-evolution.md#s-04`
- 本次范围：人工驱动的单候选经验试验、独立 regression/holdout 验证、人工批准、下一轮加载、回退。

## 目标与非目标

S-04 交付一个可重复、可审计的软进化闭环：已知失败样例 → 固定 baseline/dataset/策略 → 经验候选 → 独立验证 → 人工批准 → 下一轮实际加载 → 回退。经验只进入受限的单次运行上下文；候选不会修改 Agent 项目源码，也不会自动获得批准或发布权限。

本次不实现 S-02、H-01、H-02、H-03、L-01；不执行未知候选代码的安全隔离，不实现常驻循环、自动硬进化、远端发布或自动批准。S-04 的人工试验不宣称为安全自动模式。

## 实现内容

- `packages/improvement/src/soft-trial.ts`：新增 `assessSoftTrial`，统一检查空 regression/holdout、结果完整性、可比性、候选退出码、改善、回归、Judge/策略 hard gate、holdout 结果和 admission。
- `packages/experience/src/index.ts`：增加 `importRecord`，将候选复制到隔离 trial store；增加 `restorePointer`，支持人工激活后的显式回退。
- `packages/cli/src/index.ts`：增加 `soft-trial prepare|validate|approve|run|rollback`；验证阶段使用隔离经验库，运行阶段才正式激活，内部评估输出保持静默，外层只输出一个结构化 `canary.soft-trial` JSON。
- `packages/cli/tests/cli.e2e.test.ts`：覆盖成功闭环、未批准拒绝、负面候选拒绝、缺 Judge/结果拒绝、源码不变和 rollback。

## 实际闭环

1. 测试创建 `broken` 已知失败和 `holdout` 保留集，并记录 baseline run。
2. 人工提出并验证 project-scoped 经验；`prepare` 保存 baseline run、经验内容哈希、数据身份、case 列表、预算和此前 active pointer，状态为 `prepared`，授权仍为 `not_approved`。
3. `validate` 将经验导入隔离 store，在隔离 store 中显式激活；对 regression 与 holdout 独立重跑，生成 `comparison.json` 和 `validation.json`。改善 `broken` 且无回归时进入 `validated`。
4. 没有人工确认时 `run` 返回拒绝；提供 actor 和 reason 后进入 `approved`。
5. `run` 正式激活经验并执行下一轮，`RunSnapshot.experiences` 记录实际加载的经验 ID；测试确认 Agent 源码字节内容与激活前一致。
6. `rollback` 将经验转回 `validated`，恢复此前 active pointer，最终 loaded 经验为空，状态为 `rolled_back`。

## 验收矩阵

| 条件                                 | 结果 | 证据                                                                                              |
| ------------------------------------ | ---- | ------------------------------------------------------------------------------------------------- |
| 已知失败的可重复样例                 | 通过 | S-04 CLI e2e：`broken` baseline exit 1                                                            |
| 固定 baseline、regression 和 holdout | 通过 | `prepare` 记录 `baselineRunId`、case IDs、`datasetIdentity`                                       |
| 独立 regression/holdout 验证         | 通过 | `validate` 写入 `comparison.json`、`validation.json`；成功测试检查两组 ID                         |
| 质量改善                             | 通过 | 成功试验 comparison verdict 为 `improve`，`broken` 在 improvements 中                             |
| 人工确认与授权                       | 通过 | 未批准 `run` 拒绝；`approve` 强制 `--actor` 和 `--reason`                                         |
| 下一轮实际加载经验                   | 通过 | activated 输出包含 `loadedExperienceIds`；runner snapshot 记录引用                                |
| 负面候选被拒                         | 通过 | 负面 e2e 验证 exit 1、状态 `rejected`、不能 `approve`                                             |
| 缺必需 Judge/缺结果不能激活          | 通过 | Judge 缺失 e2e 验证 rejected、exit 1、正式 active pointer 为空                                    |
| 预算、作用域和提案证据               | 通过 | `prepare` 检查 project scope、validated 状态、case/字符预算；经验输入安全检查沿用 S-03            |
| accepted/verified 不能绕过验证       | 通过 | `validate` 只依据独立运行和 `assessSoftTrial`；`approve` 仅接受 `validated` 且 `validation.valid` |
| 项目源码保持不变                     | 通过 | 成功 e2e 对比 Agent 源文件内容，`sourceUnchanged=true`                                            |
| 回退                                 | 通过 | 成功 e2e 检查 `rolled_back`、active pointer 和 loaded 列表为空                                    |
| 默认 demo                            | 通过 | `15/15` cases、`45/45` assertions                                                                 |

## 验证命令

- `pnpm build`：通过，exit 0。
- `pnpm test`：通过；CLI `30/30` tests，improvement 包 `12/12` tests，workspace 测试全部通过。
- `pnpm typecheck`：通过，exit 0。
- `pnpm lint`：通过，exit 0。
- `pnpm format:check`：仓库既有问题，exit 1；仅报告未由本次任务修改的 `CONTRIBUTING.md`。本次新增/修改文件未被报告。
- `pnpm demo:headless`：通过，15/15 cases、45/45 assertions，exit 0。
- `git diff --check`：通过，exit 0；Git 关于 CRLF/LF 的 warning 不构成 whitespace error。

日志：

- `docs/evidence/logs/s04-build.txt`
- `docs/evidence/logs/s04-test.txt`
- `docs/evidence/logs/s04-typecheck.txt`
- `docs/evidence/logs/s04-lint.txt`
- `docs/evidence/logs/s04-format-check.txt`
- `docs/evidence/logs/s04-demo-headless.txt`
- `docs/evidence/logs/s04-diff-check.txt`

## 结论与边界

S-04 的人工驱动软进化端到端试验已实施并完成验收。它是一次显式、有限、可回退的人工工作流，不是自动发布或安全自动模式。后续任务仍需遵循路线图推荐顺序；本次不开始 S-02 或 H/L 系列任务。
