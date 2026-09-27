# 当前路线收尾与 R13–R15 执行记录

日期：2026-09-26；开始于 `bd8262a` 加现有未提交 R10–R12 工作树。Windows 本机，后续结果按步骤补录。

## 1. R12 修复状态真实页面验收

预期：失败 → 修复 → 关联重跑 → 地图显示已验证，保留原始失败及历史源码。

实际：`node scripts/run-logged.mjs verification/map -- node scripts/verify-map.mjs` 通过。真实失败 `run_a59e50b8-da35-42e8-97ea-4eda6295d996`、修复子运行 `run_74edff54-4887-46ef-b9e1-21e10ad34df1` 均封存并校验通过。Edge 页面显示绿色 verified 节点和“修复后已验证”，源码从原 Git commit 恢复并核对哈希，保留 `MAP_REPAIR_FAILURE` 原始错误。

产物：`.canary/logs/verification/map/2026-09-26T01-56-11-895Z-5d47f9f1/map-acceptance.json`；fixture 与 artifact 在 `.canary/verification/map-pEDdfS`，均被 Git 忽略。可重复执行脚本保存在源码目录。

主线复核：符合 R12 验收；使用确定性本机命令，没有模型费用。此 fixture 是功能验收，不能冒充 R9 真实历史故障数据集。

## 2. R13 架构诊断

预期：从真实解析的边定位循环与显式分层违规；观察和错误分开。

实际：新增结构分析、规则校验和 TS 路径别名/字面量 require/dynamic import 解析。分析只用静态 resolved 导入及包依赖；推断边不生成违规证明。6000 节点循环测试没有递归溢出。结果保存在 `architecture-analysis.json`，页面、CLI 和 MCP 共用封存结果。

主线复核：为地图提供可定位、可核对的架构信息，不以模型评分猜测好坏。规则违规目前是诊断信息，不自动改变现有 CI 门禁。

## 3. R14 变更影响

预期：固定基线，保留直接变更与消费者传播链；未知依赖不伪装成完整影响。

实际：`change-impact.json` 保存基线 commit、变更路径、反向导入/包依赖和包成员的保守扩展。共享模块到消费者保留原边 ID。删除/重命名、缺少结构输入及解析缺口给出明确回退原因；跨源码快照的组合被拒绝。历史 CLI 读取结果不随当前文件修改改变。

主线复核：显示潜在影响，不把静态影响当作已经发生的失败；删除/重命名尚没有旧版依赖图，因此执行全量，未冒充精确增量。

## 4. R15 增量 CI 与真实页面

预期：默认全量、显式增量、保留前置项；省略不计通过，失败不变绿。

实际：`--affected --base` 与 `impact` 预览已接入项目配置的 `impact.paths/always`。未声明范围继续执行；信息不足全量。选择理由、原始配置与实际配置均被 manifest 保护。机器 CI、JSON/Markdown 与 JUnit 保留选择范围和省略，JUnit 省略项为 skipped。页面显示增量范围、架构诊断、变更解释和检查证据入口；证据损坏时诊断面板随地图停止展示。

真实验收：`pnpm verify:architecture-ci` 的固定 JS fixture 在 Edge 通过四步。全量 `run_32f4a1c5-f154-4fbc-ac9d-ace2b544d849` 执行 3 项，增量 `run_5b711feb-7f37-4454-9926-d01c90e4fbab` 执行 2 项并保留 prep 前置项，other 明确省略。错误计算 `run_47aaec6f-50e9-4e1e-b3ca-feed103dfca0` 返回 1；包清单变化 `run_0b9d5758-d915-4bc8-ab03-514a024b17c6` 回退到 3 项全量。页面风险定位、消费者影响、CI 计划、省略范围提示和原始证据抽屉可操作，无脚本异常。

产物：`.canary/logs/verification/architecture-ci/2026-09-26T02-15-45-328Z-341218d8/acceptance.json`。这是行为验收，3→2 是选择数量证据，未声称普遍耗时收益或真实客户实验。所有步骤模型调用为 0。

主线复核：实现了架构 → 影响 → CI 的同一数据链。省略依赖完整的人工范围契约；有动态输入或声明不完整时应使用全量。独立项目的漏选率/收益仍需真实数据。

## 5. R9 剩余验证与明确状态

复核自身项目历史发现 27 份有界项目记录，仅有一组可验证的失败/通过重跑谱系。`collect-real-pairs.mjs` 收录 2 条历史观察，1 个故障组，全部划入 holdout；旧证据缺少可恢复结构，真实回放验证为 0。状态 `insufficient-real-pairs`，退出码 2，原始报告位于 `.canary/logs/verification/real-pairs/2026-09-26T02-19-12-601Z-3c7c39ce/corpus.json`。

R9-02：blocked，缺少目标数量的真实来源及可恢复版本。R9-05：blocked，缺少独立参与者。模型 Judge 人工校准：blocked，缺少人工标签；含 Judge 的比较继续证据不足。已补[采集与参与步骤](../guides/external-validation.md)和反馈模板。不能用自造错误、本机执行时间或自动标签替代上述验证。

macOS/原生 Ubuntu 与长跑继续 deferred；不重启付费模型任务、不向外发送邀请或数据。

## 6. 最终基线与回退

全仓类型检查与测试通过（CLI 138、Web 40），首次最终检查只在验收脚本 lint 的条件表达式处失败，修正后 lint、format 和 diff 检查通过。原始记录保留于 `.canary/logs/verification/final-check/2026-09-26T02-19-14-996Z-7dcff89e/`，没有用后一次通过覆盖失败。

收尾复核补了前置检查输入变化向下游传播及运行环境检查始终执行的边界。两个结构测试在最后一次并发运行触发原有 5 秒超时，日志保留于 `.canary/logs/verification/structure-final/2026-09-26T02-29-34-572Z-f327066b/`；没有移除断言或提高超时。结构编译器现固定被测根目录、关闭不需要的 ambient types 加载，结构测试文件串行执行，后续 11 项通过，记录在 `2026-09-26T02-31-20-093Z-2c18a780/`。

两个真实浏览器验收再次通过，记录在 `.canary/logs/verification/acceptance-final/`。自身仓库的实际结构复核为 343 文件、12 条诊断、405 条未解析关系；当前变更包含全局配置和图外输入，所以 6 项检查全部选中，未伪称已缩减本仓库 CI，原始数据在 `.canary/logs/verification/architecture-ci/project-audit.json`。

代码收口基线 `3b8a76902dfb756225732a681050beb994e1a5fc` 已在独立干净目录 `.canary/verification/delivery-3b8a769` 通过冻结依赖离线安装、构建、`verify:map` 与 `verify:architecture-ci`，Git 工作树干净。使用项目固定 pnpm 10.15.0、Node 24.18.0；系统 pnpm 为 11.25.0，项目执行尊重 packageManager 固定版本。日志索引 `.canary/logs/verification/delivery/result.json`。

随后 Windows 源码复核补上 LF Git blob 恢复 CRLF 工作树的路径，候选字节必须匹配封存 SHA-256，不能放宽哈希检查。Web 41 项通过，日志在 `.canary/logs/verification/source-crlf/2026-09-26T02-38-39-760Z-2d41c70f/`。最终代码基线为 `c5c735456495e339e3b1a9890664d47bf1da0121`，其干净目录 `.canary/verification/delivery-c5c7354` 同样通过固定依赖离线安装、构建、地图修复验收及架构/增量 CI 验收；原始索引 `.canary/logs/verification/delivery/result-c5c7354.json`。

全局启动器已更新到该基线，备份在 `C:/Users/temp-admin/.canary/backups/2026-09-26T02-40-52-075Z`。从 `C:/Users/temp-admin/Desktop` 调用已安装启动器，显式指定本仓库配置并在 4318 启动；`canary paths` 核对 invocationRoot 为 Desktop、projectRoot/artifactRoot 为 Canary，没有混淆安装根和检测根。

真实运行 `run_5a8c614d-d15b-42ef-bbda-2e2513261ea1` 的 build、typecheck、lint、format、全仓 test、Agent 回归六项全部 passed，原 artifact 位于 `.canary/artifacts/<runId>/`，manifest verified。结构绑定 `c5c7354`，344 个文件、1404 个节点、12 条架构诊断。Edge 验证真实页面二维首层 19 个节点、三维视图、架构诊断和全量 6/6 CI 计划，脚本异常为 0。归档结果 `.canary/logs/verification/architecture-ci/current-project-page.json`。本次覆盖来源仍是 Agent 子运行的声明范围，不代表整个仓库覆盖率。

该页面服务在本次交付时保留，地址 `http://127.0.0.1:4318/?runId=run_5a8c614d-d15b-42ef-bbda-2e2513261ea1`；服务退出后端口不会自动常驻。代码未推送远端、未触发 GitHub 工作流。最后的文档提交只记录已完成结果，代码基线不变。

最终主线复核：R12 收尾与 R13–R15 本机核心功能、真实入口、持久化、页面和可复现交付均完成。R9 真实数据/参与者/人工校准明确 blocked，R6/R7 用户暂缓项明确 deferred，不合并为已完成。回退到全量只需移除 `--affected`，旧配置兼容，历史 artifact 保留。
