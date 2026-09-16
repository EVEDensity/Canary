# R1 运行器稳定性与测试隔离：执行记录

> 状态：已完成当前 R1 范围（Windows Node 24）；不代表 R2–R8、Ubuntu/macOS 或整体生产级认证完成。执行日期：2026-09-16（Asia/Shanghai）。

## 1. 基线与环境

| 项目        | 实际值                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------ |
| 基线 commit | `49f688e641b15765af23d4ac1a7ec6510072a58d`（R0 CLI contract）                                    |
| 本轮代码    | 基线上未提交工作区变更；没有创建 commit，也未安装或覆盖用户全局 launcher                         |
| 工作目录    | C:\Users\temp-admin\Desktop\Canary                                                               |
| OS          | Windows 11，10.0.26200                                                                           |
| Node / pnpm | 24.18.0 / 10.15.0                                                                                |
| Shell       | PowerShell 5.1；verify:r0 子进程使用 cmd.exe                                                     |
| 范围        | 统一运行状态/超时/取消/预算；tmp/env/port/lock 隔离；并发与重复执行；进程树终止；checkpoint 恢复 |
| 非目标      | R2 完整 doctor 修复、R3 artifact 哈希/隐私、R4 跨语言 CI、R6 三平台实测、自动写源码、付费模型    |

依赖沿用已有 node_modules，没有执行 clean install。POSIX 信号与 macOS/Ubuntu 进程组行为有代码适配层，本轮没有真实机器证据，状态为 declared。

## 2. 目标、非目标与兼容边界

- **目标**：按路线图 R1 交付子进程树终止、超时、取消、孤儿回收；独立临时目录、端口、环境和工作目录；并发锁、重复执行去重与运行 ID；崩溃后读取 partial run 并收尾。
- **非目标**：OS 沙箱、通用语言项目发现、artifact 内容哈希、三平台 verified、自动修改用户项目。
- **可改路径**：`packages/runner`、`packages/isolation`、`packages/cli` 运行编排、`packages/evaluators` 归因、相关测试与 `current/`/`guides/`/`evidence/`/`roadmap/`。
- **兼容边界**：R0 CLI/root/退出码契约必须回归通过；普通 `canary run` 仍为 0/1；`--ci` 将非预期超时/取消/预算映射为退出码 3；预期 `execution.termination` 断言通过时不误报 3。
- **验收命令**：`pnpm build`、`pnpm check`、`pnpm verify:r0`，外加 hanging/非零退出/重复启动/并发/锁残留/临时目录冲突的故障注入测试。
- **停止条件**：上述验收通过并写入本记录；Ubuntu/macOS 标 declared，不扩大为 R6。

## 3. 实际交付

| 路径                                                                                       | 行为变化                                                                                                                                   |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/runner/src/lifecycle.ts`                                                         | 统一 completed/timeout/cancelled/budget_exceeded/error；取消优先于超时，超时优先于预算                                                     |
| `packages/runner/src/workspace.ts`                                                         | 每 run 独立 tmp/work/lock/env/port；`RUN_LOCK_HELD`/`DUPLICATE_RUN`/`STALE_LOCK`/`TMPDIR_CONFLICT`/`PORT_CONFLICT`；release 时回收孤儿进程 |
| `packages/runner/src/checkpoint.ts`                                                        | `checkpoint.json` v1；崩溃后 recover 不覆盖已完成 case；残留子进程未回收时保持 interrupted                                                 |
| `packages/runner/src/index.ts`、`child-script.ts`                                          | function worker 使用隔离 TMPDIR；超时不再覆盖已发生的预算终止；无 workspace 的临时目录在结束后清理                                         |
| `packages/isolation/src/process.ts`                                                        | Windows `taskkill /T`、POSIX 进程组 SIGTERM/SIGKILL、pidAlive、waitForExit、reclaimOrphans                                                 |
| `packages/cli/src/app.ts`、`ci.ts`                                                         | 运行中写 checkpoint；启动时收尾 stale run；CI 中途异常按 pid 关联 partial run，信封带回 runId/artifactPath/已完成计数并写 ci.json          |
| `packages/evaluators/src/index.ts`、`packages/core` schema/types                           | `budget_exceeded` 归因；`RunSnapshot.recoveryOf`                                                                                           |
| `packages/cli/tests/r1-isolation.test.ts`、`packages/runner/tests/r1-stability.test.ts` 等 | hanging 子孙进程、非零退出、预算、锁/端口/tmp 冲突、同项目并发、CI 取消退出码 3、partial recover                                           |

Agent 子进程的 cwd 仍是 projectRoot（保证 entry 解析兼容）；隔离工作目录通过 `CANARY_WORKDIR` 与 `artifactDir/work` 提供，不把项目源码目录当成可清空的临时盘。

## 4. 验收与原始证据

| 命令/检查                                        | 结果                                                  | 证据                                                                  |
| ------------------------------------------------ | ----------------------------------------------------- | --------------------------------------------------------------------- |
| `pnpm build`                                     | exit 0                                                | 本记录环境表；工作区 dist 已更新                                      |
| `pnpm check`                                     | exit 0；typecheck、全量 test、lint、format:check 通过 | [完整检查日志](logs/r1-check.txt)                                     |
| `pnpm verify:r0`                                 | exit 0；真实临时 launcher 与 pnpm 的 CI 各 15/15      | [命令输出](logs/r1-verify.txt)、[结构化记录](logs/r1-acceptance.json) |
| hanging 子孙进程超时后 pid 释放                  | runner r1-stability + isolation process.test 通过     | 全量检查日志                                                          |
| 非零退出分类为 `error`                           | runner 测试通过                                       | 全量检查日志                                                          |
| 重复 live lock / 不同 runId 占用 / 残留死 pid 锁 | `DUPLICATE_RUN` / `RUN_LOCK_HELD` / stale reclaim     | 全量检查日志                                                          |
| 并发两项目与同项目两次运行                       | 不同 runId、不同 TMPDIR、互不覆盖 artifact            | cli r1-isolation 测试                                                 |
| 端口冲突、tmp owner 冲突                         | `PORT_CONFLICT` / `TMPDIR_CONFLICT`                   | runner r1-stability                                                   |
| 取消后保留已完成 case；CI abort 退出码 3         | checkpoint 含 completedCaseKeys；`--ci` 映射 3        | cli r1-isolation                                                      |
| 中途 throw 关联 checkpoint 与 ci.json            | runId/artifactPath/summary 来自 partial run           | cli r1-isolation                                                      |

verify:r0 的 launcher CI runId：**run_665107e2-7c67-471c-9952-a3cc1022d424**；随后 `pnpm canary run --ci` 为 **run_240e97fc-388e-4605-a5b2-c4f8bbed37a4**。缺配置退出码 2，未在临时目录写入 `.canary`。SHA-256 比对 227 个受跟踪及新增源码/脚本文件，验收命令本身未改写这些文件。

全量测试统计（实际 pnpm check 输出，非估算）：

| 包             |  通过数 |
| -------------- | ------: |
| core           |       7 |
| exporter-core  |      15 |
| mcp-server     |       9 |
| environment    |       2 |
| evaluators     |      15 |
| adapters       |       7 |
| coverage       |      22 |
| experience     |       4 |
| reporters      |       5 |
| policy         |       8 |
| trace          |       5 |
| improvement    |      12 |
| isolation      |       7 |
| hard-evolution |       6 |
| runner         |      31 |
| loop           |       6 |
| control-plane  |      25 |
| web            |      16 |
| cli            |      85 |
| **合计**       | **287** |

相对 R0 的 264，本轮新增的是 runner/isolation/cli 的故障注入与恢复测试，不是把旧失败改成通过。

## 5. 与总文档的一致性审计

| 必查项            | 结论                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| 本地优先/自动外发 | 保持；未启用 exporter，不寻找模型凭证，不上传原始输入输出                                        |
| 原始数据暴露      | checkpoint 只记录路径、pid、case key 与终止原因；全量隐私扫描仍属 R3                             |
| 根目录混淆        | 未改变 R0 四类 root；workspace 位于 `artifactRoot/<runId>/`                                      |
| verified/declared | Windows Node 24 为 verified；Ubuntu/macOS、Node 22、真实满盘/强杀来不及写 checkpoint 为 declared |
| 生态适配过度宣传  | 不宣称 OS 沙箱或多语言 CI                                                                        |
| 循环自动启动      | 未改变；run / run --ci 不启动 loop                                                               |
| 异常可审计        | 取消/超时/预算/非零退出可分类；崩溃后可从 checkpoint 收尾；无 checkpoint 的强杀仍可能没有 runId  |
| 个人维护成本      | 未新增运行时依赖或云服务                                                                         |

## 6. 未覆盖边界与回滚

未覆盖（保持 declared/excluded，不在本阶段扩大）：

- Ubuntu LTS 与 macOS 的真实进程组/信号验收（适配层已存在，无本机证据）。
- Node 22 兼容矩阵。
- 断电半写 `run.json` 的原子性（R3/R7）。
- 真实满盘、Docker 故障、不可信配置的 OS 沙箱。
- 通用 command/http/filesystem 检查编排（R4）。

回滚：备份当前工作区 diff 后，仅撤回本记录列出的 R1 文件；不要清空 `.canary` 或删除历史 run。旧 `run.json` 仍可读；新增 `checkpoint.json` / `recoveryOf` 对旧消费者是可忽略字段。`run.lock` 残留且 pid 已死时，下一次 `acquireRunLock` 会标记 stale 并接管，不会覆盖兄弟 run 的 artifact。

下一阶段是 R2：配置发现与 `doctor/paths/version` 的完整冲突/权限/修复验收。
