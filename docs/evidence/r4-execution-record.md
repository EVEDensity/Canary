# R4 项目级门禁：执行记录

状态：**已完成 R4 当前范围（Windows Node 24 / Python 3.12）**。执行日期：2026-09-19（Asia/Shanghai）。

## 范围与基线

- 基线 commit：`c0cceda`，叠加本工作区已完成但未提交的 R3；保留原有全部修改。
- 目标：项目发现、六类检查编排、环境白名单、JSON/JUnit、稳定退出码、超时/取消/总预算、R3 证据衔接及真实 Node/Python/Canary 自身验收。
- 可改路径：core 契约，CLI 发现与执行，reporters，trace 子证据校验与保留保护，runner checkpoint 所属关系；相关 fixture、测试、脚本、当前文档。
- 兼容边界：旧式 agent 配置与 CI v1 保持；增加 project-checks scope。未知项目不自动执行脚本。默认无页面、外发或修复。
- 停止条件：实现、验收、原始日志及文档同步完成。R5 页面、自动重试、R6 三平台、R7 长跑不纳入本轮。

## 主线检查

新增独立 `canary.project` 配置，不将 command 检查包装为 agent case。检查结果进入现有 RunSnapshot/manifest；reporters 支持项目结果。doctor 增加配置分支以避免合法项目配置被旧式 agent schema 错判。trace 的小范围改动用于递归检查 agent 子证据与保护其保留关系，保持 R3 完整性约束。

过程问题如实记录：首次 agent 测试发现 Vitest 环境缺少 import.meta.resolve，改为已有 Node createRequire 解析启动器后通过；全局启动器脚本的 Windows 引号问题改为已有 R0 argv 用法；首次完整实机流程的源码校验因代理同时修改三份源码而正确失败，后续在停止编辑源码后重跑；lint 发现冗余初始赋值，直接删除，没有禁用规则或放宽测试。

## 环境与验收

取消边界复核补充：agent 配置导入移入可取消的子 CLI，防止顶层 await 阻塞父检查预算；内部 `--agent-check` 拒绝项目递归。CI 异常恢复只查找当前进程拥有的 checkpoint，避免子 CLI 配置失败时误恢复父运行。历史清理按引用关系先删除引用者、再删除被引用运行，补测父子同时过期的情况。

Windows 11 25H2（10.0.26200）、Node 24.18.0、pnpm 10.15.0、PowerShell 7.6.5、Python 3.12.10。Docker CLI 已安装，但 dockerDesktopLinuxEngine pipe 不存在，daemon 成功路径不标 verified。未安装新运行时依赖。

- `pnpm build`：exit 0，见 [构建日志（归档）](logs/README.md)。
- `pnpm check`：19 个包、335 项测试（R4 新增 16 项）以及 typecheck、lint、format 通过，见 [完整检查（归档）](logs/README.md)。
- `pnpm verify:r3`：12 项证据链回归通过，见 [结构化记录](logs/r4/r4-r3-acceptance.json)和 [输出（归档）](logs/README.md)。
- `pnpm verify:r4`：8 项验收 verified：真实 Node/Python 成功和断言失败、未知项目 blocked、Docker 不可用不误报成功、Canary 自身 typecheck + agent 门禁、252 个源码/脚本/配置文件未变化。见 [结构化记录](logs/r4/r4-acceptance.json)和 [输出（归档）](logs/README.md)。
- `pnpm verify:r0`：临时全局启动器和 pnpm 默认 agent CI 两轮均 15/15 通过，根目录、CI v1 与源码未变化检查保持。见 [结构化记录](logs/r4/r4-r0-acceptance.json)和 [输出（归档）](logs/README.md)。

测试覆盖 schema/依赖/optional/platform、命令和文件断言、缺少执行器、超时/预算/取消、就绪探针及孙进程回收、HTTP 授权/状态/重定向、环境白名单/摘要上限/隐私漏写、doctor、agent 证据引用与损坏/保留关系、挂起配置导入和项目递归。

主线收敛到 R4，下一阶段为 R5；未扩展页面或启动自动修复。

## 边界与回退

源码哈希是有范围的清单，外部服务及主动脱离进程树的服务不在复现保证内。Docker 成功态使用适配器契约测试；真实 daemon、其他 OS 和 Node 22 保持未验收。

回退仅移除 R4 新配置、发现器、检查编排及对应扩展，保留 R3 工作区。既有 agent 配置可继续使用；没有执行 commit、push、全局安装、Docker 启停或源码修复动作。实现与使用规则见 [R4 使用说明](../guides/r4-project-checks.md)。
