# 源码核对：当前能力与自循环缺口

> 更新于 2026-09-14，覆盖 F/Q/S 完成态以及 H-01/H-02/H-03/L-01。完整包测试通过不意味着 OS 级沙箱或未实测 MCP 宿主互操作已认证。

> R0 增量（2026-09-16）：已取消安装 Demo 隐式回退，新增 CI/schema/退出码契约与临时 launcher 真实验收；见 [执行记录](r0-execution.md)。下表保留旧任务审计历史，不再作为后续执行清单。

## 关键事实与任务

| 代码位置 / 符号                             | 实际行为 / 风险                                                             | 任务                            |
| ------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------- |
| CLI `resolveProjectContext`、全局启动器     | 项目根与 artifact 跟随 config；安装根不覆盖本地项目                         | F-01（已实施）                  |
| CLI / Web 生命周期                          | headless 不听 HTTP；写接口需要 token                                        | F-02（已实施）                  |
| `@canary/core` contracts                    | Experiment/Trial 仍不进入默认 `canary run`；authorization/activation 已接线 | F-03、H-01/H-03（已实施）       |
| `@canary/trace`                             | JSONL v1、脱敏、异步 sink                                                   | F-04（已实施）                  |
| Runner ports / `runEvaluation`              | 默认评估路径不变；可选 `isolation` 请求走受限 env + preload                 | F-05、H-01（已实施）            |
| `compareRuns` / Judge / holdout / admission | 完整性比较、fail-closed Judge、保留集身份、admission 默认 hold              | Q-01～Q-04（已实施）            |
| Skill + `host` CLI                          | Codex Desktop 固定宿主闭环                                                  | S-01（已实施）                  |
| MCP Server                                  | `@canary/mcp-server` dual-era 服务端；默认无源码写；与 adapters 客户端分开  | S-02（已实施）                  |
| `@canary/experience` + `soft-trial`         | 经验加载与人工软进化闭环                                                    | S-03/S-04（已实施）             |
| `@canary/policy` / `@canary/isolation`      | 外置策略、预算锁、userspace 隔离；OS 隔离按探测 fail closed                 | H-01（已实施）                  |
| `@canary/hard-evolution`                    | 候选工作区、独立验证、受信应用/撤销/回滚                                    | H-02/H-03（已实施）             |
| `@canary/loop`                              | 独立可恢复控制器，不安装即自启                                              | L-01（已实施）                  |
| Web 控制面谱系/审批 UI                      | 已实现本地版本绑定审批、固定锚点、保留集审计与 Web/CLI；默认只读            | [L-02 已实施](l02-execution.md) |
| 分发矩阵 / OTel                             | 未做跨平台安装验收与可选导出                                                | L-03（待实施）                  |
| `MemoryStateStore.restore`                  | 只恢复内存；`externalRollback=unsupported`                                  | H-01/H-03 已标明边界            |

## 需要保持的边界

- userspace preload **不是** Windows AppContainer / 内核沙箱。原生扩展仍可能绕过 hook。
- 默认 `canary run` 评估受信项目 Agent 时仍使用普通 worker；该路径不能用于未知候选或自动硬写。
- `compare.improve`、`admission.hold`、`verified` 不是发布许可。
- 自动硬写在策略要求 OS 隔离且未探测到 Docker/`bwrap` 时必须失败，不能静默降级。
- 循环控制器默认 idle；没有执行器时进入等待，不会寻找未授权模型凭证。

## 验证范围

H/L 包级拒绝测试覆盖 POL-01/02/03/05/06/07/09 与 H-02/H-03/L-01 清单。S-02 验收覆盖仓库内 dual-era 测试客户端与 `canary mcp matrix`；Cursor/Claude/Codex 的 MCP 连接字符串未单独实测。浏览器真实交互、全局安装仍不是本轮验收。
