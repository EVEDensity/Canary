# 后续任务总表

> 当前后续任务以 [R16–R21：变更验证与修复产品路线](13-r16-r21-change-verification.md)为准，首项是 R16-01。R13–R15 已完成本机核心验收，不重新编号或重复实施。R0–R8 的历史基线见[个人开发者生产级测试路线图](06-personal-production-test-roadmap.md)，R9–R15 的范围和证据见下文。旧 F/Q/S/H/L 文档仅用于追溯。

## 当前基线

2026-09-26 重新核对：已有本地项目检查、Agent 评估、证据链、关联重跑、结构地图、架构诊断及保守增量 CI。实现基线与局限见 [R13–R15 执行记录](../evidence/r13-r15-execution.md)。这些能力是后续复用的工程基础，尚不能证明外部用户的排障效率或采用意愿。

下一阶段产品定位为**现有 CI 上面的变更验证与修复工具**，服务普通软件项目和使用 AI 编写代码的项目。优先打通失败证据、复现、修复验证，再解释 CI 全绿时的变更验证缺口。GitHub PR/Actions 是日常入口，CLI 负责本地执行，页面与地图负责下钻，MCP/JSON 支持编码 Agent。

现有 Agent、经验和 Skill 能力继续保留；未来任务优先服务这条用户流程。跨平台余项和长跑保持原暂缓状态，外部数据与用户验证保持真实状态，不将它们重新设为核心开发的前置条件。

## 新执行阶段

| 阶段 | 主题                                  | 状态                                                                                                                                                                                                                                |
| ---- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R0   | 基线冻结、根目录和 CLI 契约           | 已完成，见 [R0 证据](../evidence/r0-execution.md)                                                                                                                                                                                   |
| R1   | 运行器稳定性、隔离、并发和恢复        | 已完成（Windows Node 24），见 [R1 证据](../evidence/r1-execution-record.md)                                                                                                                                                         |
| R2   | 配置发现、`doctor/paths/version` 诊断 | 已完成（Windows Node 24），见 [R2 证据](../evidence/r2-execution-record.md)                                                                                                                                                         |
| R3   | artifact、隐私、可复现和证据链        | 已完成（Windows Node 24），见 [R3 证据](../evidence/r3-execution-record.md)                                                                                                                                                         |
| R4   | 全局 `canary run --ci` 门禁           | 已完成（Windows Node 24 / Python 3.12），见 [R4 证据](../evidence/r4-execution-record.md)                                                                                                                                           |
| R5   | 全面 `canary run` 和本地报告页面      | 已完成（Windows Node 24），见 [R5 证据](../evidence/r5-execution-record.md)                                                                                                                                                         |
| R6   | 三平台真实验证和 Agent fixtures       | 部分完成：Windows/Ubuntu 容器 Node 24/22、固定 Pi runtime 与一次真实推理已验收；macOS/原生 Ubuntu 延后至开源 CI，见 [R6 证据](../evidence/r6-execution-record.md)                                                                   |
| R7   | 长跑、容量、断点恢复和运行手册        | 初步维护已完成；长跑、容量压测和重启实验按用户决定暂缓，见 [R7 记录](../evidence/r7-initial-maintenance.md)                                                                                                                         |
| R8   | 受控 Skill/软自进化                   | R8-01 至 R8-09 的 Windows 本机最小闭环已验收，见 [执行记录](../evidence/r8-05-09-execution.md) 和 [计划边界](07-r8-controlled-skill-plan.md)                                                                                        |
| R9   | 外部可用性与评估可信度                | R9-00/01 试点见 [交付记录](../evidence/r9-00-01-execution.md)；R9-03/04 的确定性比较与诊断流程见 [执行记录](../evidence/r9-03-04-execution.md)；R9-02/05 与模型评分人工校准仍待验证，见 [任务安排](08-r9-external-validity-plan.md) |
| R10  | 项目结构与变更模型                    | 已实现静态结构、Git 变更、历史快照和四入口共用；语言与动态关系边界见 [R10 计划](09-r10-structure-model.md)及[证据](../evidence/r10-execution.md)                                                                                    |
| R11  | 可交互项目架构地图                    | 已实现首页入口、二维/三维分层、逐层导航、搜索/过滤、详情与历史源码哈希保护；见 [R11 计划](10-r11-architecture-map.md)及[证据](../evidence/r11-execution.md)                                                                         |
| R12  | 覆盖、分支与失败的地图联动            | 已实现测量分母、三色模式、分支源码高亮、失败定位与未知状态；见 [R12 计划](11-r12-map-diagnostics.md)及[证据](../evidence/r12-execution.md)                                                                                          |

R0 完成范围是现有 Agent case CI 入口、根目录/退出码/schema 冻结和 Windows 本地验收。R1 完成范围是运行器状态/超时/取消/预算、隔离与 Windows 进程树恢复。R2 完成配置发现与 doctor/paths/version 诊断。R3 完成 manifest、哈希、谱系、脱敏和损坏/恢复验收，并提供可复现元数据及显式历史清理。R4 完成项目发现、显式六类检查、CI 报告、预算和 Node/Python 实机 fixture，Docker daemon 成功路径仍为 blocked。以上范围以 Windows Node 24 为本地基线；R5 完成本地报告、历史比较、显式重跑和资源快照；R6 的跨平台余项已延后；R7 已完成快速维护范围；R8-00 已形成独立代码基线，R8-01 至 R8-09 的最小闭环已在本机固定函数 Agent 验收。真实模型长期收益与跨平台余项仍未由 R8 验收覆盖。

R0–R8 的详细交付物、依赖、验收命令和排除项见[原阶段路线图](06-personal-production-test-roadmap.md)；R9 任务以[新增计划](08-r9-external-validity-plan.md)为准。

## R13–R15 当前执行

2026-09-26 用户确认继续架构分析、变更影响和 CI 产品阶段，计划见[R13–R15](12-r13-r15-architecture-ci.md)，逐步复核与实际验收见[执行记录](../evidence/r13-r15-execution.md)。

- **R13 已完成本机核心验收**：循环依赖、显式分层违规与耦合观察，封存分析供页面/CLI/MCP 共用。
- **R14 已完成本机核心验收**：固定 Git 基线、反向消费者及包成员影响、解释链与未知回退。
- **R15 已完成本机核心验收**：显式增量选择、前置项、全量回退与省略披露；真实浏览器证据通过。操作见[架构与 CI](../guides/architecture-ci.md)。
- **R9-02 blocked**：只收集到 2 条历史观察、1 个故障组，0 对完成源码回放；目标 10 对尚未达到。
- **R9-05 与 Judge 人工校准 blocked**：缺少独立用户和人工标签，步骤与模板见[外部验证](../guides/external-validation.md)。

上述实现通过确定性验收，不宣称普遍 CI 性能提升、完整动态依赖图或真实用户留存已经验证。R6 跨平台余项与 R7 长跑保持 deferred。

## R16–R21 后续任务安排

以下均为 **planned**，详细子任务、依赖、文件范围、验收和回退见[唯一执行计划](13-r16-r21-change-verification.md)。本轮完成的是路线恢复，不是下列功能实现。

1. **R16：统一故障证据包与诊断契约。** R16-01 公共问题模型；02 错误提取；03 分类归组；04 可移交证据包；05 CLI/页面/MCP 共用入口。
2. **R17：GitHub PR 与现有 CI 接入。** R17-01 接入契约；02 PR/执行版本身份；03 Summary 与 artifact；04 可选 PR 发布；05 真实接入验收与退出路径。
3. **R18：可复现执行。** R18-01 复现说明；02 隔离工作区；03 原失败匹配；04 明确结果与环境缺口；05 人和 AI 共用操作。
4. **R19：修复有效性验证。** R19-01 候选身份；02 相同回归测试前败后过；03 原检查和相关回归；04 验证条件削弱检查；05 分级结论与显式门禁。
5. **R20：变更验证缺口。** R20-01 普通项目覆盖导入；02 差异覆盖分母；03 显式行为契约；04 证据种类区分；05 PR/地图/门禁联动。
6. **R21：统一流程与可复现交付。** R21-01 操作导航；02 编码 Agent 交接；03 核心链路验收；04 接入与维护文档；05 真实收益测量字段。

执行顺序为 R16 → R17 → R18 → R19 → R20 → R21。R16–R19 构成首个核心交付；远端权限不足只阻塞远端验收，不阻塞本地开发。每完成子任务按计划复核是否服务定位、复现、修复或验证缺口，并登记实际证据。暂不扩展云平台、自治修复机器人或新的大屏改版。

## 明确排除

以下内容不属于当前个人开发者目标，不得重新作为 L-03 或 P-07 引入：npm registry clean install、独立 registry CLI package、平台二进制、签名制品、provenance、SBOM、供应链验证、完整 Phoenix/Langfuse 生态适配和默认云端 exporter。

## 历史文档

以下文档是已经实施阶段的设计和证据，不等于新路线图的完成证明：

- [工作协议](00-working-protocol.md)：通用实施和证据规则；
- [基础与入口](01-foundation-and-entry.md)；
- [评估完整性](02-evaluation-integrity.md)；
- [宿主与软进化](03-host-and-soft-evolution.md)；
- [受控硬进化](04-controlled-hard-evolution.md)；
- [旧持续循环和生态](05-continuous-loop-and-ecosystem.md)。

当前代码事实见[代码审计](../evidence/code-audit.md)。历史文档中的“已实施”只表示当时范围内的实现状态，不能把三平台、全局 `--ci` 或生产级认证自动推导为已完成。
