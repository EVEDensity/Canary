# Canary 文档导航

> **代码与可复现结果决定现状；设计描述目标；任务文件描述未完成工作。** 不以历史 RFC、测试数量或模型总结替代源码核对。
> 当前代码以 Git 工作区为准；阶段状态以 [任务总表](roadmap/README.md)及对应执行记录为准，历史验证日期不代表当前全部能力。

## 按目的阅读

| 我想做什么                                    | 从这里开始                                                                                                                                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 运行当前项目                                  | [安装与启动](guides/getting-started.md) → [运行 / UI / Replay](guides/running-and-ui.md)                                                                                                                      |
| 接入自己的 Agent                              | [适配器与环境](guides/adapters-and-environment.md) → [评估与覆盖率](guides/evaluation-and-coverage.md)                                                                                                        |
| 使用已有改进建议                              | [当前 improvement 流程](guides/improvement.md)，不是自动进化                                                                                                                                                  |
| 理解实际实现                                  | [当前架构](current/architecture.md) → [源码核对与缺口](evidence/code-audit.md)                                                                                                                                |
| 理解理想 Agent 自循环                         | [理想自循环](design/agent-loop.md) → [硬规范与软 / 硬进化](design/evolution-policy.md)                                                                                                                        |
| 理解全局安装、Dashboard、Skill/MCP 的产品目标 | [产品目标架构](design/product-architecture.md)                                                                                                                                                                |
| 接手下一项开发                                | **[任务总表与依赖](roadmap/README.md)**，按任务 ID 领取一个切片                                                                                                                                               |
| 查看实测数据与旧报告                          | [本轮验证](evidence/validation-baseline.md) / [R0](evidence/r0-execution.md) / [R1](evidence/r1-execution-record.md) / [R2](evidence/r2-execution-record.md) / [历史数据索引](evidence/historical-results.md) |
| 查资料与旧设计来由                            | [研究资料](research/agent-evolution.md) / [历史档案](archive/README.md)                                                                                                                                       |

R6 平台与 Agent fixture 见 [指南](guides/r6-platform-fixtures.md)和 [实际执行记录](evidence/r6-execution-record.md)。Pi 固定运行时及一次受限真实推理已验证；macOS 与原生 Ubuntu 延后。当前能力边界见[支持与证据矩阵](guides/support-matrix.md)。

R9 的可复现交付与三个外部项目试点见 [执行记录](evidence/r9-00-01-execution.md) 和 [试点配置](../integrations/r9-external/README.md)。
R9 的确定性比较证据等级和页面诊断路径见 [R9-03/04 执行记录](evidence/r9-03-04-execution.md)。
R10 的项目结构、Git 变更及历史运行绑定见[使用指南](guides/project-structure.md)和[执行记录](evidence/r10-execution.md)。
R11 的交互架构地图见[使用指南](guides/architecture-map.md)、[阶段计划](roadmap/10-r11-architecture-map.md)与[执行记录](evidence/r11-execution.md)。
R12 的覆盖、分支和失败地图联动见[使用指南](guides/architecture-map.md)、[阶段计划](roadmap/11-r12-map-diagnostics.md)与[执行记录](evidence/r12-execution.md)。
R13–R15 的架构诊断、变更影响与增量 CI 见[操作与 Schema](guides/architecture-ci.md)、[阶段计划](roadmap/12-r13-r15-architecture-ci.md)与[执行记录](evidence/r13-r15-execution.md)。R9 剩余真实数据和参与者输入见[外部验证](guides/external-validation.md)。

**下一阶段：** [R16–R21：变更验证与修复产品路线](roadmap/13-r16-r21-change-verification.md)。依次规划统一故障证据、GitHub PR 接入、复现、修复有效性验证、变更验证缺口和完整交付；全部为待实施，首项 R16-01。既有 R13–R15 保留，不重复开发。

R4/R5 默认入口、完整项目门禁与真实全局启动验收见 [入口收尾记录](evidence/entry-execution-record.md)。

项目检查与 Agent 评估已合并为[统一验证工作台](guides/unified-workspace.md)，包含覆盖率来源、用例轨迹和证据比较。

## 目录职责

artifact 校验、脱敏、恢复谱系和历史清理见 [R3 使用说明](guides/r3-artifact-evidence.md)与 [R3 执行记录](evidence/r3-execution-record.md)。

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

普通项目运行页面见 [R5 使用说明](guides/r5-local-report.md)与 [R5 执行记录](evidence/r5-execution-record.md)。

项目级检查接入见 [R4 使用说明](guides/r4-project-checks.md)，实施与验收见 [R4 执行记录](evidence/r4-execution-record.md)。

当前是本地测试、轨迹、覆盖率和改进建议工作台。旧 S/H/L 阶段已有宿主、MCP、经验和控制器实现，其历史验收不能代替 R0–R8 的新阶段验收；实际接线与可信边界见 [当前架构](current/architecture.md)。

“默认软进化”只描述未来授权上限；安装不等于启动后台任务。硬进化只有在未来权限、隔离和门禁完成并获授权后才可用。

## 给后续 AI / 人的维护规则

1. 先读当前源码与测试，核对本地 SHA、未提交改动和目标任务；文档冲突时修正文档，不按旧文档强改代码。
2. 任务状态仅在代码、测试及证据齐备后更新。设计稿、接口草案或一次 Demo 通过不算该任务完成。
3. 当前行为变更同步更新 `current/`、相关 `guides/` 和 `evidence/`；未来目标只改 `design/`；任务安排只在 `roadmap/` 维护，避免三份路线图漂移。
4. 原始轨迹不直接提交；证据目录只保存经检查的本地测试日志或脱敏摘要。历史数值保留日期、范围、原始出处，不合并成当前总成绩。
5. 文件链接采用仓库内相对路径，方便跨机器阅读；终端交付时报告绝对路径。新增文档必须从导航可达。
6. 后续任务以用户当轮授权范围为准，阶段文档不会自动授权模型消费、远端发布或部署。

旧文件位置与处理方式见 [文档迁移记录](evidence/document-migration.md)。
