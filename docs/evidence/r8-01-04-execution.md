# R8-01 至 R8-04 执行记录

日期：2026-09-24。起点：`77f34f06661c94137c7d7cdae40730f74779f176`，Windows / Node 24.18.0 / pnpm 10.15.0。范围为现有能力审计、项目候选、上下文选择和离线收益比较；批准与激活的后续结果见 [R8-05 至 R8-09 执行记录](r8-05-09-execution.md)。

## R8-01：代码能力和唯一所有者

- 经验 Schema、状态和作用域：`packages/core/src/contracts.ts`。`proposed → validated → active` 是原有状态序列；本轮增加项目检查维度、来源哈希、限制和验证要求。没有新建第二套经验状态机。
- 经验存储、版本、激活指针、去重、预算与加载：`packages/experience/src/index.ts`。S-03 的项目级文件库继续是唯一经验存储；本轮增加检查 ID、类型、工具、语言匹配，并核对激活指针中的版本和内容哈希。
- 项目失败到候选的固定规则：`packages/experience/src/project-candidates.ts`。只接收已封存运行中的失败或阻塞检查；错误输出只用于证据哈希，候选正文来自审阅过的分类规则。
- Agent 对照与独立验证：`packages/improvement/src/index.ts`、`soft-trial.ts`。S-04 的 regression/holdout、比较、批准前验证和回滚继续复用。项目检查的离线比较集中在 `project-comparison.ts`。
- 人工保护操作：`packages/control-plane/src/index.ts`。其软试验批准、重核与回滚机制继续是后续 R8-05 的所有者；本轮没有新建批准 API。
- CLI 编排与证据写入：`packages/cli/src/index.ts`。新增项目候选和比较命令；项目候选直接 `validate/activate` 被拒绝，留待 R8-05 独立试验与人工批准接入。
- MCP proposal：`packages/mcp-server/src/tools.ts`。仍只保存未批准宿主提案，不调用项目候选自动激活。
- 页面：`apps/web/src/project-issues.ts`、`workspace.ts`、`workspace-ui.ts`。已有问题分类、错误证据与重跑定位；候选审批和收益界面属于 R8-07，本轮未复制一套页面状态。

审计结论：已有实现是 S-03 的文件存储、作用域和激活指针，以及 S-04 的 Agent soft-trial、批准和回滚；本轮复用它们的状态、预算和证据契约。缺口是项目检查失败尚不能形成结构化候选、按检查上下文筛选，或对两个封存项目运行作保守比较；R8-02 至 R8-04 填补这些缺口。废弃的重复方案是另建经验库、第二套批准 API 或第二套页面问题状态，均未实施。

## R8-02：结构化项目候选

`canary experience propose-project <runId>` 首先校验 manifest，再读取同一项目的已完成或失败运行。候选保留 run/check ID、manifest 哈希、已脱敏检查证据哈希、错误类别、固定建议规则、检查类型、工具、语言、限制及验证要求。来源相同且内容、适用范围相同的重复请求返回原版本。构建、测试、lint、format、覆盖率、配置和超时等分类均有固定建议；原始 stderr/stdout 和任意工具指令不会成为经验正文。候选保持 `proposed`。

## R8-03：最小上下文选择

在原有 projectRoot、case、tag、feature、条数和字符预算基础上增加 check ID、check type、tool、language。任一声明维度缺失或不匹配即跳过；损坏的激活指针哈希也跳过。Agent 运行的 `run.json` 记录实际加载经验 ID、版本、哈希和适用 case ID，由原有 manifest 封存；控制面运行谱系将这组选择条件与实际加载引用一起展示。项目检查经验当前仅可查询适用性，不注入到普通项目命令；它们在 R8-05 独立试验完成前无法通过 CLI 直接激活。

## R8-04：离线比较

`canary experience compare-project <baseline> <candidate> --regression <id> --holdout <id>` 只读取同一项目内两个 manifest verified 的运行。要求检查计划相同、结果完整、两组非空且不重叠、holdout 在基线通过、候选无新增失败和硬门禁失败。报告给出通过率、各检查状态、错误分类和累计检查耗时；仅在来源哈希及分母一致的最终覆盖率存在时显示覆盖率差值。项目检查未记录完整重试次数或 token 时明确标记 `unavailable`。比较结果写入候选运行的 `project-comparison.json` 并更新 manifest；相同输入的再次比较复用已验证报告，不推进 manifest 修订号。

比较报告的 `observedImprovement` 只表示两个项目运行的检查结果发生改善，`attribution.status` 保持 `unverified`，`admissible` 保持 false。项目代码可能在两次运行间改变；仅凭历史快照不能断言经验导致改善。固定函数 Agent 的独立试验与人工批准结果见 [后续执行记录](r8-05-09-execution.md)。

## 验证与边界

- 真实 Node 子进程 fixture：基线测试失败，修复后同一检查计划的候选运行通过；生成的项目候选仍为 `proposed`；离线比较得到改善但不宣称经验归因；新比较文件的 manifest 保持 verified。
- 针对性测试覆盖恶意日志不进入正文、重复候选去重、跨项目/检查/工具/语言/字符预算隔离、实际加载适用 case 的页面数据、指针哈希损坏、类别规则、holdout 回归、计划漂移、结果缺失、硬门禁、相同输入比较幂等和损坏 manifest 拒绝。
- 不运行模型、不修改项目源码、不执行自动批准。本轮的比较只读取已有运行；真实 fixture 的两次检查属于本地测试进程。

验收命令：`pnpm build`、`pnpm check`（含全仓 typecheck、test、lint 和 format:check）均通过；`git diff --check` 无差异错误。测试日志按项目日志策略存于 `.canary/logs/tests/`。

回滚本轮新增项目命令和比较文件生成后，原 S-03/S-04 经验存储、Agent 试验、控制面和页面问题定位仍可按旧契约工作。历史 artifact 不做批量改写。
