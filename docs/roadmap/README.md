# 后续任务总表

> 本目录的唯一执行入口是[个人开发者生产级测试路线图](06-personal-production-test-roadmap.md)。它是 2026-09-15 确认的新基线，后续实现必须按 R0-R8 顺序推进。旧 F/Q/S/H/L 文档保留用于历史追溯，不再直接作为待实施清单。

## 当前基线

Canary 的定位是本地优先的 Agent/应用测试工作台，目标是个人开发者真实可维护的生产级测试能力。当前重点不是 npm 发布、平台二进制、签名制品、供应链证明或云端观测，而是：

- 稳定运行器、超时/取消/崩溃恢复和测试隔离；
- artifact 完整性、隐私和可审计证据链；
- `canary run --ci` 全局自我排查和稳定退出码；
- 全面的 `canary run` 与只监听回环地址的本地报告页面；
- Windows、Ubuntu、macOS 三平台行为验证；
- 可复用的 Node、Python、Go、Rust、Docker 和 Agent fixture；
- 在核心稳定后，以 Skill 形式进行受控的 prompt/策略软进化。

## 新执行阶段

| 阶段 | 主题                                  | 状态                                                                                                                |
| ---- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| R0   | 基线冻结、根目录和 CLI 契约           | 已完成，见 [R0 证据](../evidence/r0-execution.md)                                                                   |
| R1   | 运行器稳定性、隔离、并发和恢复        | 已完成（Windows Node 24），见 [R1 证据](../evidence/r1-execution-record.md)                                         |
| R2   | 配置发现、`doctor/paths/version` 诊断 | 已完成（Windows Node 24），见 [R2 证据](../evidence/r2-execution-record.md)                                         |
| R3   | artifact、隐私、可复现和证据链        | 已完成（Windows Node 24），见 [R3 证据](../evidence/r3-execution-record.md)                                         |
| R4   | 全局 `canary run --ci` 门禁           | 已完成（Windows Node 24 / Python 3.12），见 [R4 证据](../evidence/r4-execution-record.md)                           |
| R5   | 全面 `canary run` 和本地报告页面      | 已完成（Windows Node 24），见 [R5 证据](../evidence/r5-execution-record.md)                                         |
| R6   | 三平台真实验证和 Agent fixtures       | 部分完成：Windows/Ubuntu 容器 Node 24/22 已验收；macOS/Pi blocked，见 [R6 证据](../evidence/r6-execution-record.md) |
| R7   | 长跑、容量、断点恢复和运行手册        | 待实施                                                                                                              |
| R8   | 受控 Skill/软自进化                   | 核心稳定后实施                                                                                                      |

R0 完成范围是现有 Agent case CI 入口、根目录/退出码/schema 冻结和 Windows 本地验收。R1 完成范围是运行器状态/超时/取消/预算、隔离与 Windows 进程树恢复。R2 完成配置发现与 doctor/paths/version 诊断。R3 完成 manifest、哈希、谱系、脱敏和损坏/恢复验收，并提供可复现元数据及显式历史清理。R4 完成项目发现、显式六类检查、CI 报告、预算和 Node/Python 实机 fixture，Docker daemon 成功路径仍为 blocked。以上范围为 Windows Node 24，R5 完成本地报告、历史比较、显式重跑和资源快照，不代表 R6–R7 或三平台生产级验收完成。下一任务是 R6。

阶段的详细交付物、依赖、验收命令、状态定义和排除项见[新路线图](06-personal-production-test-roadmap.md)。

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
