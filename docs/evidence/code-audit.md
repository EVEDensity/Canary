# 源码核对：当前能力与自循环缺口

> 更新于 2026-09-14，覆盖 F/Q/S 完成态以及 H-01/H-02/H-03/L-01。完整包测试通过不意味着 OS 级沙箱已认证。

## 关键事实与任务

| 代码位置 / 符号                             | 实际行为 / 风险                                                             | 任务                      |
| ------------------------------------------- | --------------------------------------------------------------------------- | ------------------------- |
| CLI `resolveProjectContext`、全局启动器     | 项目根与 artifact 跟随 config；安装根不覆盖本地项目                         | F-01（已实施）            |
| CLI / Web 生命周期                          | headless 不听 HTTP；写接口需要 token                                        | F-02（已实施）            |
| `@canary/core` contracts                    | Experiment/Trial 仍不进入默认 `canary run`；authorization/activation 已接线 | F-03、H-01/H-03（已实施） |
| `@canary/trace`                             | JSONL v1、脱敏、异步 sink                                                   | F-04（已实施）            |
| Runner ports / `runEvaluation`              | 默认评估路径不变；可选 `isolation` 请求走受限 env + preload                 | F-05、H-01（已实施）      |
| `compareRuns` / Judge / holdout / admission | 完整性比较、fail-closed Judge、保留集身份、admission 默认 hold              | Q-01～Q-04（已实施）      |
| Skill + `host` CLI                          | Codex Desktop 固定宿主闭环                                                  | S-01（已实施）            |
| MCP Server                                  | 仍只有客户端 adapter，没有 Canary MCP 服务端                                | S-02（待实施）            |
| `@canary/experience` + `soft-trial`         | 经验加载与人工软进化闭环                                                    | S-03/S-04（已实施）       |
| `@canary/policy` / `@canary/isolation`      | 外置策略、预算锁、userspace 隔离；OS 隔离按探测 fail closed                 | H-01（已实施）            |
| `@canary/hard-evolution`                    | 候选工作区、独立验证、受信应用/撤销/回滚                                    | H-02/H-03（已实施）       |
| `@canary/loop`                              | 独立可恢复控制器，不安装即自启                                              | L-01（已实施）            |
| Web 控制面谱系/审批 UI                      | 仍是运行观察，不是 L-01 控制面                                              | L-02（待实施）            |
| 分发矩阵 / OTel                             | 未做跨平台安装验收与可选导出                                                | L-03（待实施）            |
| `MemoryStateStore.restore`                  | 只恢复内存；`externalRollback=unsupported`                                  | H-01/H-03 已标明边界      |

## 需要保持的边界

- userspace preload **不是** Windows AppContainer / 内核沙箱。原生扩展仍可能绕过 hook。
- 默认 `canary run` 评估受信项目 Agent 时仍使用普通 worker；该路径不能用于未知候选或自动硬写。
- `compare.improve`、`admission.hold`、`verified` 不是发布许可。
- 自动硬写在策略要求 OS 隔离且未探测到 Docker/`bwrap` 时必须失败，不能静默降级。
- 循环控制器默认 idle；没有执行器时进入等待，不会寻找未授权模型凭证。

## 验证范围

H/L 包级拒绝测试覆盖 POL-01/02/03/05/06/07/09 与 H-02/H-03/L-01 清单。浏览器真实交互、全局安装、MCP 多宿主互操作仍不是本轮验收。
