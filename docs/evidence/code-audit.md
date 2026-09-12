# 源码核对：当前能力与自循环缺口

> 基线 `30f11cf4a303ab8616fb702bad8348bba4955466`。本次不修改运行时代码。以下为源码核对与定向探针结论；完整包测试通过不意味着这些边界已安全。

## 关键事实与任务

| 代码位置 / 符号                                                                                                           | 实际行为 / 风险                                                                                        | 后续任务     |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------ |
| [install-global.mjs](../../scripts/install-global.mjs)，启动器 spawnSync                                                  | cwd 固定安装 repoRoot，继承环境并设置 CANARY_HOME；不能保证运行调用目录项目                            | F-01         |
| [home.ts](../../packages/cli/src/home.ts)、[CLI](../../packages/cli/src/index.ts)，resolveConfigFile / runCommandDetailed | 解析可回退安装 home；run 产物根为配置目录；历史命令未统一目标选择                                      | F-01         |
| CLI runCommandDetailed                                                                                                    | listen 在执行前，但打印 URL/打开浏览器在 await 执行后；headless 仍绑定端口，web.enabled 未在此路径生效 | F-02         |
| CLI / [Web](../../apps/web/src/index.ts)                                                                                  | CLI 使用 Web 的 RunStore/FileArtifactRepository；Web 含 replay/建议写接口，CORS 不是写授权             | F-02/04/05   |
| [Runner](../../packages/runner/src/index.ts)                                                                              | 内联 worker、直接导入评估/覆盖率/适配器；Node 进程继承环境权限，取消管理不等于沙箱                     | F-05、H-01   |
| CLI 配置/用例 import、[Evaluators](../../packages/evaluators/src/index.ts) predicate                                      | 可以执行代码，不都是隔离纯数据；仅隔离 Agent 子进程不够                                                | H-01         |
| [Adapters](../../packages/adapters/src/index.ts) 及 Runner                                                                | function/http/mcp Agent，mcp-http 是 Tool；简化 MCP 调用不保证任一完整协议兼容                         | S-02、F-05   |
| [Environment](../../packages/environment/src/index.ts)，MemoryStateStore.restore                                          | 恢复内存对象，不撤销 HTTP/MCP 或现实外部副作用                                                         | H-01/03      |
| Evaluators，judge.score / DeterministicJudgeProvider                                                                      | 默认回退主要检查输出存在，可返回 score/confidence 1；CLI/Runner 未注入真实 Judge                       | Q-02         |
| Evaluators，HttpJudgeProvider / timeout                                                                                   | Promise.race 超时不等同取消上游 fetch/计费                                                             | Q-02、F-05   |
| [Improvement](../../packages/improvement/src/index.ts)，compareRuns                                                       | caseId Map 覆盖 repetitions；遗漏候选通过用例不一定算回归；缺 coverage 的差值按 0                      | Q-01/04      |
| Improvement，proposedCase / renderRegressionDraft                                                                         | assertion 可能只保留 type，input 可从 output 兜底，草稿可降为 output.exists                            | Q-03         |
| Improvement，holdout / decideSuggestion                                                                                   | holdout 依 ID 字符串，verified 是状态迁移，不是隐藏集验证证明                                          | Q-03         |
| CLI candidate                                                                                                             | 比较 verdict 没有可靠合并 executed.exitCode 与完整性；compare 不是发布门禁                             | Q-01/04      |
| [Coverage](../../packages/coverage/src/index.ts)、CLI hard gate                                                           | approximate/exact 和 unavailable 要分别解释；负例允许预期 policy/loop，不等同生产权限豁免              | Q-04、H-01   |
| [Trace](../../packages/trace/src/index.ts)、Web/CLI                                                                       | 部分脱敏不覆盖所有输入/输出/事件出口；SSE 事件内存保存，不保证跨重启游标恢复                           | F-04         |
| Web 的 logo 路径                                                                                                          | 运行时引用 docs/images/logo.png，因此本轮保留 images 原路径与文件内容                                  | 文档迁移约束 |

表内路径是定位入口，后续实施请以符号与当时源码重新查找，不依赖会漂移的行号。

## 已执行的最小反例（非新增仓库测试）

探针调用本地已构建的 improvement API；下列是其输入/观察结果的简化记录。这里只描述已复现结果，不宣称自动化回归测试已落地。

| 场景         | 基线                                                         | 候选                           | 实际观察                                            | 应补的保护                          |
| ------------ | ------------------------------------------------------------ | ------------------------------ | --------------------------------------------------- | ----------------------------------- |
| 遗漏用例     | one 通过，two 失败                                           | 仅 two 通过                    | verdict=improve，regressions=[]，improvements=[two] | 预期用例完整性，缺失不能获胜        |
| 重复试验覆盖 | one 通过                                                     | one trial 1 失败，trial 2 通过 | verdict=keep，regressions=[]                        | 按 trial 保存并聚合，不以最后值覆盖 |
| 断言失真     | 失败 tool.args#0，含 expected 细节，完整 EvalResult coverage | 生成建议 proposedCase          | assertions 仅含 type=tool.args                      | 完整保留操作数，缺失则拒绝自动生成  |

第一个比较场景中缺 coverage 的 delta 为 0，不能解释为真实“覆盖率不变”。断言探针最初构造的数据缺少必需 coverage，补全后才得到上表结果；不将构造错误算作项目缺陷。

## 需要纠正的旧承诺

- “全局安装后自动运行当前项目”是未来目标，不是当前 launcher 事实。
- “Judge fail closed”只能描述某些已有错误路径，不能覆盖缺少 Provider 的默认语义。
- “完整轨迹”只适用于可观测埋点；远端黑盒内部行为不能自动获得。
- “重复 N 次”不代表统计可信；当前 compare 甚至会覆盖 trial。
- “verified / compare improve”不是独立安全准入，也不授权自动源码修改。
- “不改源码”是当前能力边界；未来硬模式可以在明确授权与独立门禁下写源码，不能写成永久产品禁令。
- “MCP 必须 initialize”必须限定旧协议版本；现代协议另有元数据机制，见[研究资料](../research/agent-evolution.md)。

## 验证范围

[本轮验证](validation-baseline.md)记录 build、105 tests、typecheck、lint、默认 Demo 等。浏览器真实交互、全局安装、MCP 多宿主互操作、安全隔离和自动进化均没有在本轮完成验收。
