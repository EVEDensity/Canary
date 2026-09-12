# 源码核对：当前能力与自循环缺口

> 基线 `30f11cf4a303ab8616fb702bad8348bba4955466`。本次不修改运行时代码。以下为源码核对与定向探针结论；完整包测试通过不意味着这些边界已安全。

## 关键事实与任务

| 代码位置 / 符号                                                                                          | 实际行为 / 风险                                                                                        | 后续任务            |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------- |
| [install-global.mjs](../../scripts/install-global.mjs)，启动器 spawnSync                                 | 启动器 `cwd` 为调用目录，`CANARY_HOME` 指向安装仓库；本地 `canary.config.ts` 优先，artifact 跟随项目根 | F-01（已实施）      |
| [home.ts](../../packages/cli/src/home.ts)、[CLI](../../packages/cli/src/index.ts)，resolveProjectContext | 显式 `--config` → 向上查找 → CANARY_HOME → cwd；历史命令与 run 共用同一 ProjectContext                 | F-01（已实施）      |
| CLI runCommandDetailed                                                                                   | 非 headless 先 listen 并打印 UI；`--headless` / `web.enabled: false` 不监听；写接口需要 token          | F-02（已实施）      |
| CLI / [Web](../../apps/web/src/index.ts) / [trace](../../packages/trace/src/index.ts)                    | RunStore/FileArtifactRepository 在 `@canary/trace`；headless 不加载 Web 实现类                         | F-04/F-05（已实施） |
| [Runner](../../packages/runner/src/index.ts)                                                             | worker 已拆到 child-script；CaseExecutor 端口存在。Node 进程仍继承环境权限，取消管理不等于沙箱         | H-01                |
| CLI 配置/用例 import、[Evaluators](../../packages/evaluators/src/index.ts) predicate                     | 可以执行代码，不都是隔离纯数据；仅隔离 Agent 子进程不够                                                | H-01                |
| [Adapters](../../packages/adapters/src/index.ts) 及 Runner                                               | function/http/mcp Agent，mcp-http 是 Tool；简化 MCP 调用不保证任一完整协议兼容                         | S-02、F-05          |
| [Environment](../../packages/environment/src/index.ts)，MemoryStateStore.restore                         | 恢复内存对象，不撤销 HTTP/MCP 或现实外部副作用                                                         | H-01/03             |
| Evaluators，judge.score / DeterministicJudgeProvider                                                     | 缺少必需 Provider 时失败；stub 需显式 verdict。CLI 从 `judge` 配置注入                                 | Q-02（已实施）      |
| Evaluators，HttpJudgeProvider / timeout                                                                  | 超时 abort fetch；无 allowOutbound 不外发                                                              | Q-02（已实施）      |
| [Improvement](../../packages/improvement/src/index.ts)，compareRuns                                      | trial 键对账；缺测/取消为 incomparable；coverage 非 final 不按 0 做差                                  | Q-01/04（已实施）   |
| Improvement，proposedCase / renderRegressionDraft                                                        | 保留可序列化断言与原始 input；不可恢复则拒绝生成                                                       | Q-03（已实施）      |
| Improvement，holdout / decideSuggestion                                                                  | holdout 用 tags/dataset.split；verified 仍是状态迁移，不是隐藏集验证证明                               | Q-03（已实施）      |
| CLI candidate                                                                                            | 合并 exitCode 与 incomparable/admission reject；admission hold 不是发布许可                            | Q-01/04（已实施）   |
| [Coverage](../../packages/coverage/src/index.ts)、CLI hard gate                                          | approximate/exact 和 unavailable 要分别解释；负例允许预期 policy/loop，不等同生产权限豁免              | Q-04、H-01          |
| [Trace](../../packages/trace/src/index.ts)、Web/CLI                                                      | JSONL v1、异步 sink、落盘 snapshot/HTTP/SSE 走脱敏；覆盖率源码产物仍可能含源码。SSE 游标不跨重启       | L-02、F-04 余量     |
| Web 的 logo 路径                                                                                         | 运行时引用 docs/images/logo.png，因此本轮保留 images 原路径与文件内容                                  | 文档迁移约束        |

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

- “全局安装后运行当前项目”：调用目录（及向上）有 `canary.config.ts` 时运行该项目；否则回退安装仓库 Demo。
- “Judge fail closed”：未配置必需 Provider 的 `judge.score` 现在失败；deterministic stub 不是语义 Judge。
- “完整轨迹”只适用于可观测埋点；远端黑盒内部行为不能自动获得。
- “重复 N 次”不代表统计可信；当前 compare 甚至会覆盖 trial。
- “verified / compare improve”不是独立安全准入，也不授权自动源码修改。
- “不改源码”是当前能力边界；未来硬模式可以在明确授权与独立门禁下写源码，不能写成永久产品禁令。
- “MCP 必须 initialize”必须限定旧协议版本；现代协议另有元数据机制，见[研究资料](../research/agent-evolution.md)。

## 验证范围

[本轮验证](validation-baseline.md)记录 build、105 tests、typecheck、lint、默认 Demo 等。浏览器真实交互、全局安装、MCP 多宿主互操作、安全隔离和自动进化均没有在本轮完成验收。
