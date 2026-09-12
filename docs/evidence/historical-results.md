# 历史数据索引（不作当前验收）

旧报告保留原始范围、失败、修复过程与数字。下面只将有价值的数据分离索引，不将历史 PASS 改写为本轮 PASS，不重新认证旧报告中的市场数据或能力断言。

| 历史来源                                                                   | 原报告记录的有用数据                                                                            | 如何解读                                                                       |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [Week 1](../archive/reports/WEEK-1-ISSUES.md)                              | 最早 full tests：coverage 6、runner 4、web 2、CLI 1；还有后续追加的 fixture/映射/采样结果       | 同一文档有多个阶段，不把最早计数当最终基线；保留 stale dist 导致失败的排查记录 |
| [Week 2](../archive/reports/WEEK-2-ISSUES.md)                              | coverage 18、evaluators 4、runner 8、web 5、CLI 3；示例 1 case / 2 assertions；branches 1/2     | 当时示例和用例规模不同；保留 glob/JSDoc 修复与 build-before-test 经验          |
| [Week 3](../archive/reports/WEEK-3-ISSUES.md)                              | 示例 14/14 cases、35 assertions；lines 55/56、functions 14/14、branches 33/44、statements 57/64 | 不能与当前 15 case/新分母直接作能力提升比较                                    |
| Week 3 benchmark                                                           | summarizeCoverage：200 iterations、54 ms、3703.7 ops/sec                                        | 原报告单次本机微基准，未在本轮复测，也不是端到端 Agent 吞吐                    |
| [初始架构报告](../archive/design/MVP-ARCHITECTURE-INITIAL-REPORT.md)       | 当时的架构评判、竞品/社区规模和选型材料                                                         | 历史分析，不重新核实 star 数/排名，不把“已实现”总标记套到当前全部目标          |
| [MVP 验收审阅](../archive/reports/MVP-IMPLEMENTATION-ACCEPTANCE-REVIEW.md) | 针对早期占位实现的缺口表、风险与验收清单                                                        | 其中“未实现”可能已过时，不能作为当前代码快照                                   |

本轮数据单独见[验证基线](validation-baseline.md)。旧报告中的绝对路径和 runId 仅保留为历史证据，文件在当前机器是否仍存在不构成文档导航保证。
