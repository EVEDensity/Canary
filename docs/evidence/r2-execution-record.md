# R2 配置发现与自我诊断：执行记录

> 状态：已完成当前 R2 范围（Windows Node 24）；不代表 R3–R8、Ubuntu/macOS 或整体生产级认证完成。执行日期：2026-09-17（Asia/Shanghai）。

## 1. 基线与环境

| 项目        | 实际值                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------ |
| 基线 commit | `94a71c70687a06bbe19d2fac1850879f6b8ff908`（docs: update top-level README）                            |
| 本轮代码    | 基线上未提交工作区变更；没有创建 commit，也未安装或覆盖用户全局 launcher                               |
| 工作目录    | C:\Users\temp-admin\Desktop\Canary                                                                     |
| OS          | Windows 11 25H2，10.0.26200                                                                            |
| Node / pnpm | 24.18.0 / 10.15.0                                                                                      |
| Shell       | PowerShell 5.1；verify:r0 子进程使用 cmd.exe                                                           |
| 范围        | 配置发现优先级与 `--config`；doctor/paths/version v1 JSON；空格/非默认目录/根冲突/权限诊断与可执行建议 |
| 非目标      | 自动改写 `home.json` 或用户配置、R3 artifact 哈希/隐私、R4 跨语言 CI、R6 三平台实测、付费模型          |

依赖沿用已有 node_modules，没有执行 clean install。Ubuntu/macOS 与 Node 22 的路径/权限语义没有本机证据，状态为 declared。真实 NTFS ACL 拒绝写入与 Unix 大小写别名未在本机注入。

## 2. 目标、非目标与兼容边界

- **目标**：按路线图 R2 让 `canary doctor` 能自己找出“为什么没有正常测试”：配置发现、schema 导入、不可写 artifact、install/project 冲突、路径空格、非默认用户目录、符号链接/junction 别名；每个问题带可执行建议。
- **非目标**：OS 沙箱、自动修复元数据、通用语言项目发现、把 warning 升级成失败退出码、三平台 verified。
- **可改路径**：`packages/cli` 的 doctor/paths/home 诊断与测试；`docs/guides/r0-cli-contract.md` 的 R2 诊断说明；`docs/current/architecture.md`、`docs/roadmap/`、本记录。
- **兼容边界**：保持 R0 v1 schema 字段；只增加 issue `code` 值，不新增 doctor JSON 顶层字段。`paths` 仍不执行配置。普通 `canary run` 仍为 0/1。doctor 缺配置/坏配置退出 2，仅不可写 artifact 且无配置错误时退出 5。
- **验收命令**：`pnpm build`、`pnpm check`、`pnpm verify:r0`，外加缺配置、坏配置、坏元数据、缺 launcher、不可写 artifact、install/project 冲突 fixture。
- **停止条件**：上述验收通过并写入本记录；Ubuntu/macOS 标 declared，不扩大为 R6。

## 3. 实际交付

| 路径                                     | 行为变化                                                                                                                                                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/cli/src/diagnostics.ts`        | `diagnosticSnapshot` 改为异步：对受信任 `canary.config.ts` 做 schema 导入检查；探测 artifact 可写性且不留下 `.canary`；诊断 `PROJECT_INSTALL_CONFLICT` / `PATH_SPACES` / `NON_DEFAULT_USER_DIR` / `PATH_ALIAS` |
| `packages/cli/src/home.ts`               | 导出 `isInsideRoot`，供根冲突与非默认用户目录判断                                                                                                                                                              |
| `packages/cli/src/index.ts`              | `canary doctor` 等待异步诊断快照，退出码取 `payload.exitCode`                                                                                                                                                  |
| `packages/cli/tests/r2-doctor.test.ts`   | 缺配置、坏 schema、抛错配置、缺 entry、坏元数据、缺 launcher、不可写 artifact、install/project 冲突、空格/非默认目录/junction 别名；`paths` 不执行抛错配置                                                     |
| `packages/cli/tests/diagnostics.test.ts` | 对齐异步 doctor API                                                                                                                                                                                            |
| `packages/cli/tests/home.test.ts`        | `isInsideRoot` 自测与别名用例                                                                                                                                                                                  |

doctor 导入配置时静默 `console.*`，异常消息不回传密钥。探测写权限使用独占临时文件并立即删除；artifactRoot 为文件或 `.canary` 为文件时报告 `ARTIFACT_UNWRITABLE`，不改写占位内容。`PROJECT_INSTALL_CONFLICT` 为 warning：自测时 projectRoot 可等于 installRoot；仅当调用目录在安装根之外却选中安装配置时发出。不自动重写 `~/.canary/home.json`。

## 4. 验收与原始证据

| 命令/检查                                                   | 结果                                                  | 证据                                                                  |
| ----------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------- |
| `pnpm build`                                                | exit 0                                                | 本记录环境表；工作区 dist 已更新                                      |
| `pnpm check`                                                | exit 0；typecheck、全量 test、lint、format:check 通过 | [完整检查日志](logs/r2-check.txt)                                     |
| `pnpm verify:r0`                                            | exit 0；真实临时 launcher 与 pnpm 的 CI 各 15/15      | [命令输出](logs/r2-verify.txt)、[结构化记录](logs/r2-acceptance.json) |
| 缺配置 `CONFIG_NOT_FOUND` 退出 2，不创建 `.canary`          | r2-doctor 通过                                        | 全量检查日志                                                          |
| 坏 schema / 抛错配置 `CONFIG_INVALID` 退出 2，不打印密钥    | r2-doctor 通过                                        | 全量检查日志                                                          |
| 坏元数据 / 缺 launcher 为 warning，不改写 `home.json`       | r0-ci + r2-doctor 通过                                | 全量检查日志                                                          |
| artifactRoot 为文件时 `ARTIFACT_UNWRITABLE` 退出 5          | r2-doctor 通过                                        | 全量检查日志                                                          |
| 外部调用 `--config` 安装根：`PROJECT_INSTALL_CONFLICT` 且 0 | r2-doctor 通过                                        | 全量检查日志                                                          |
| 安装根内自测不报根冲突                                      | r2-doctor 通过                                        | 全量检查日志                                                          |
| 空格 / 非默认用户目录 / junction `PATH_ALIAS`               | r2-doctor 通过                                        | 全量检查日志                                                          |
| `paths` 定位抛错配置且不执行；doctor 报告 `CONFIG_INVALID`  | r2-doctor 通过                                        | 全量检查日志                                                          |

verify:r0 的 launcher CI runId：**run_fc4088fa-e93d-4472-8250-c795e055d2f2**；随后 `pnpm canary run --ci` 为 **run_9987c433-49d5-49dc-82bf-5b31b4723781**。缺配置退出码 2，未在临时目录写入 `.canary`。仓库根 `canary doctor --json` 退出 0、issues 为空。SHA-256 比对 228 个受跟踪及新增源码/脚本文件，验收命令本身未改写这些文件。

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
| cli            |      98 |
| **合计**       | **300** |

相对 R1 的 287，本轮新增的是 cli doctor fixture 与 `isInsideRoot` 测试，不是把旧失败改成通过。

## 5. 与总文档的一致性审计

| 必查项            | 结论                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------- |
| 本地优先/自动外发 | 保持；doctor 默认 `exporter.enabled=false`，不寻找模型凭证，不上传原始输入输出               |
| 原始数据暴露      | 配置导入失败不打印异常栈；console 在导入期间静默；全面隐私扫描仍属 R3                        |
| 根目录混淆        | 未改变 R0 四类 root；冲突是 warning 诊断，不是把 installRoot 当成 projectRoot                |
| verified/declared | Windows Node 24 为 verified；Ubuntu/macOS、Node 22、真实 ACL/满盘/Unix 大小写别名为 declared |
| 生态适配过度宣传  | 不宣称已完成 R4 全局多语言 `--ci` 或自动修复                                                 |
| 循环自动启动      | 未改变；doctor/paths/version 不启动 loop                                                     |
| 异常可审计        | 配置/权限/冲突均有 code、suggestion 与稳定退出码                                             |
| 个人维护成本      | 未新增运行时依赖或云服务；doctor 复用已有 tsx 导入受信任配置                                 |

## 6. 未覆盖边界与回滚

未覆盖（保持 declared/excluded，不在本阶段扩大）：

- Ubuntu LTS 与 macOS 的真实权限位、大小写敏感别名与信号验收。
- Node 22 兼容矩阵。
- 真实 NTFS ACL 拒绝写入、满盘、只读挂载。
- 自动修复 `home.json` / 用户配置（明确非目标）。
- 通用 command/http/filesystem 检查编排（R4）。
- artifact 内容哈希与半写恢复（R3/R7）。

回滚：备份当前工作区 diff 后，仅撤回本记录列出的 R2 文件；不要清空 `.canary` 或删除历史 run。doctor 新增 issue code 对旧消费者是可忽略字符串；v1 顶层字段未改。

下一阶段是 R3：artifact 完整性、可复现和隐私。
