# Canary 文档导航

> **代码与可复现结果决定现状；设计描述目标；任务文件描述未完成工作。** 不以历史 RFC、测试数量或模型总结替代源码核对。
> 本轮代码基线：`30f11cf4a303ab8616fb702bad8348bba4955466`。验证日期按 UTC 记为 2026-09-12，详细环境见验证记录。

## 按目的阅读

| 我想做什么                                    | 从这里开始                                                                                                                                                            |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 运行当前项目                                  | [安装与启动](guides/getting-started.md) → [运行 / UI / Replay](guides/running-and-ui.md)                                                                              |
| 接入自己的 Agent                              | [适配器与环境](guides/adapters-and-environment.md) → [评估与覆盖率](guides/evaluation-and-coverage.md)                                                                |
| 使用已有改进建议                              | [当前 improvement 流程](guides/improvement.md)，不是自动进化                                                                                                          |
| 理解实际实现                                  | [当前架构](current/architecture.md) → [源码核对与缺口](evidence/code-audit.md)                                                                                        |
| 理解理想 Agent 自循环                         | [理想自循环](design/agent-loop.md) → [硬规范与软 / 硬进化](design/evolution-policy.md)                                                                                |
| 理解全局安装、Dashboard、Skill/MCP 的产品目标 | [产品目标架构](design/product-architecture.md)                                                                                                                        |
| 接手下一项开发                                | **[任务总表与依赖](roadmap/README.md)**，按任务 ID 领取一个切片                                                                                                       |
| 查看实测数据与旧报告                          | [本轮验证](evidence/validation-baseline.md) / [R0](evidence/r0-execution.md) / [R1](evidence/r1-execution-record.md) / [历史数据索引](evidence/historical-results.md) |
| 查资料与旧设计来由                            | [研究资料](research/agent-evolution.md) / [历史档案](archive/README.md)                                                                                               |

## 目录职责

```text
docs/
├── README.md       # 唯一文档入口与维护规则
├── current/        # 已核对的当前实现，不放理想设计
├── guides/         # 当前可执行的使用说明
├── design/         # 尚未实现的目标：产品、自循环、权限策略
├── roadmap/        # 唯一后续任务总表、依赖、文件范围、验收和回滚
├── evidence/       # 源码证据、验证数据、历史数据索引、迁移清单
├── research/       # 外部原始资料及采用/不采用理由
├── archive/        # 历史 RFC、报告、旧周计划，不作当前执行指令
└── images/         # 既有图片；Web 源码也引用 logo，暂不迁移
```

## 当前与目标的关键区别

当前是本地测试、轨迹、覆盖率和改进建议工作台。**没有**已接线的 `/canary` Skill、Canary MCP Server、经验加载闭环、自循环调度、软/硬进化开关或自动代码发布器。默认运行不调用 Judge 模型，但也不能把内置确定性 Judge 的输出存在检查称为语义评审。

“默认软进化”只描述未来授权上限；安装不等于启动后台任务。硬进化只有在未来权限、隔离和门禁完成并获授权后才可用。

## 给后续 AI / 人的维护规则

1. 先读当前源码与测试，核对本地 SHA、未提交改动和目标任务；文档冲突时修正文档，不按旧文档强改代码。
2. 任务状态仅在代码、测试及证据齐备后更新。设计稿、接口草案或一次 Demo 通过不算该任务完成。
3. 当前行为变更同步更新 `current/`、相关 `guides/` 和 `evidence/`；未来目标只改 `design/`；任务安排只在 `roadmap/` 维护，避免三份路线图漂移。
4. 原始轨迹不直接提交；证据目录只保存经检查的本地测试日志或脱敏摘要。历史数值保留日期、范围、原始出处，不合并成当前总成绩。
5. 文件链接采用仓库内相对路径，方便跨机器阅读；终端交付时报告绝对路径。新增文档必须从导航可达。
6. 本轮只重构文档、修复文档引用并验证已有实现；不授予任何后续代码修改、模型消费、push 或部署权限。

旧文件位置与处理方式见 [文档迁移记录](evidence/document-migration.md)。
