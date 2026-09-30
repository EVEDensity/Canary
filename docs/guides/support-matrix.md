# 当前支持与证据矩阵

截至 2026-09-30。`verified` 对应已记录的版本与检查范围；`declared` 表示已有配置支持；`deferred` 表示后续验证安排。实际运行命令见[安装与启动](getting-started.md)，各阶段证据见[路线图总表](../roadmap/README.md)。最新六项项目检查、Agent 回归与页面交互结果见[项目验证记录](../evidence/2026-09-30-product-verification.md)。

| 范围                              | 当前状态                             | 边界                                                                                                                         |
| --------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Windows 11 / Node 24 / pnpm 10.15 | verified                             | R8 本机闭环、R9 外部接入及干净 checkout；只代表记录的固定版本与任务                                                          |
| Ubuntu Docker / Node 22、24       | R6 范围 verified                     | 最新 R9 工作树未重新做容器验收                                                                                               |
| 原生 Ubuntu、macOS                | deferred                             | 按用户决定，开源后通过真实 CI 环境补验                                                                                       |
| Pi                                | R6 固定运行时和一次受限推理 verified | 未证明不同宿主、模型和长期收益                                                                                               |
| 本地函数 Agent                    | verified                             | 配置范围内可采集 V8 覆盖率；覆盖率不等于任务成功率                                                                           |
| HTTP Agent                        | verified                             | POST JSON，默认请求体 `{ "input": ... }`；可用 `agent.requestField` 改为一个顶层字段，如 `message`；源码覆盖率 `unavailable` |
| MCP stdio 工具                    | 外部 `get-sum` 用例 verified         | 参考服务的单项工具调用通过；不宣称所有 MCP 生命周期、传输或宿主兼容                                                          |
| MCP Agent adapter                 | Demo 范围 verified                   | 当前固定调用名为 `run` 的工具；不同 MCP 工具可由函数 Agent 的 `tools.adapter` 接入                                           |
| MCP HTTP 工具                     | Demo 范围 verified                   | JSON-RPC POST/SSE body，尚不是完整 Streamable HTTP session 实现                                                              |
| `canary run --ci`                 | 选定项目 verified                    | 全局启动器可跨目录调用；只执行目标项目显式计划，不自动扫描电脑或代替远端 GitHub CI                                           |
| 本地报告页面                      | R5/R8 范围 verified                  | 项目检查和 Agent 运行共用工作台；页面指标依据已采集数据，未采集项显示不可用                                                  |
| 项目结构与 Git 变更               | R10 Windows fixture verified         | JS/TS 与可用 Python 符号；Go/Rust 暂到包和文件，动态/跨语言调用明确未知；旧运行只读封存快照                                  |
| 交互架构地图                      | R11 Windows Edge headless verified   | 本仓库封存运行的二维/三维、搜索、过滤、状态恢复和源码哈希保护；非 JS/TS 页面只到目录/文件，静态图不代表运行时拓扑            |

R12 覆盖/分支/失败及修复状态，R13–R15 架构诊断、静态影响与显式增量 CI 已在 Windows/Edge 本机 fixture 验收。旧图、语言解析缺失及输入声明不足的边界见[架构与 CI 指南](architecture-ci.md)。其他平台没有由本轮重新验收，不扩大 R6 历史结果的适用版本。

项目检查会生成 `check-plan.json`、`checks.json`、`run.json`、报告与 manifest，位置为**被测项目**的 `.canary/artifacts/<runId>/`。新项目运行另外封存架构诊断、影响与 CI 选择计划。Agent 子运行另有独立 runId，父记录保存其谱系与 manifest 哈希。日志在 `.canary/logs/`；原始运行产物由 Git 忽略。需对外分享证据时，先校验并按敏感数据策略导出。
