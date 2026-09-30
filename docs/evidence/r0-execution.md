# R0 基线冻结与契约清理：执行记录

> 状态：已完成当前 R0 范围；不代表 R1–R8 或整体生产级认证完成。执行日期：2026-09-16（Asia/Shanghai）。

## 1. 基线与环境

| 项目        | 实际值                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------- |
| 基线 commit | 3ee87ad45679aff66be5d6165aedb3ea6a767380                                                          |
| 本轮代码    | 基线上未提交工作区变更；没有创建 commit，也未安装或覆盖用户全局 launcher                          |
| 工作目录    | C:\Users\temp-admin\Desktop\Canary                                                                |
| OS          | Windows 11 家庭版中文版，10.0.26200，Build 26200                                                  |
| Node / pnpm | 24.18.0 / 10.15.0                                                                                 |
| Shell       | PowerShell 5.1.26100.9444；launcher 验收子进程使用 cmd.exe                                        |
| 范围        | R0 CLI/root/schema/退出码，现有 Agent case 执行路径                                               |
| 非目标      | R1 运行器重构、R2 自动修复、R3 全量隐私/完整性、R4 跨语言检查编排、R6 三平台实测、P-07 分发产品化 |

依赖沿用已有 node_modules，没有执行 clean install，没有调用付费模型，不以远端 GitHub CI 成败作为门槛。没有为六格常驻矩阵扩张维护面。

## 2. 实际交付

| 路径                                                       | 行为变化                                                                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| packages/core/src/cli-contracts.ts、index.ts、contracts.ts | v1 runtime schemas、退出码、证据状态、运行结果到退出码的确定性映射；区分历史类型兼容与当前 schema                        |
| packages/cli/src/home.ts                                   | 四类 root 单一解析源；显式配置优先、规范路径；没有项目配置就报错，不运行安装 Demo；限制 INIT_CWD 的适用范围              |
| packages/cli/src/ci.ts、index.ts                           | 真正的 run --ci 分支、严格参数预检、单行 JSON、配置错误 2、非交互/无 UI、JSON/JUnit 报告、ci.json 临时文件 rename 最终化 |
| packages/cli/src/diagnostics.ts                            | paths/doctor/version v1 输出、纯版本模式、坏元数据与缺 launcher 警告、有界本地 pnpm 探测；不自动修复                     |
| scripts/source-launcher.mjs、install-global.mjs            | 提取可测试源码 launcher；运行已构建 dist，而不是在用户项目目录解析 tsx；保留调用 cwd，清除继承的包脚本变量               |
| scripts/verify-r0.mjs、package.json                        | pnpm verify:r0 真正运行临时 PATH launcher、缺配置 fixture、诊断与 pnpm 入口，核对源码哈希并可保存结构化记录              |
| scripts/verify-distribution.mjs                            | 改为明确的声明清单 executed=false；取消“检测到 Windows 即 verified”与未执行场景硬编码 verified                           |
| packages/cli/tests/r0-*.test.ts、home.test.ts              | CI 实进程 E2E、故障分类/最终化、元数据、别名路径和 root 契约回归                                                         |
| packages/cli/tests/cli.e2e.test.ts、control.test.ts        | fixture 使用真实路径；旧测试显式传配置，不再依赖测试进程的 INIT_CWD 冒充用户调用目录                                     |
| README、guides、roadmap、readiness                         | 修复文档格式与损坏的 readiness 内容；旧路线图标历史，新 R0 契约和验收索引；R1+ 不提前完成                                |

## 3. 验收与原始证据

| 命令/检查                                          | 结果                                                  | 证据                                                                         |
| -------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| pnpm build                                         | exit 0                                                | [构建日志（归档）](logs/README.md)                                           |
| pnpm check                                         | exit 0；typecheck、全量 test、lint、format:check 通过 | [完整检查日志（归档）](logs/README.md)                                       |
| pnpm verify:r0                                     | exit 0；真实临时 launcher 与 pnpm 的 CI 各 15/15      | [命令输出（归档）](logs/README.md)、[结构化记录](logs/r0/r0-acceptance.json) |
| canary run --ci --config 不存在的配置              | exit 2；CONFIG_NOT_FOUND；不创建 fixture artifact     | 同上                                                                         |
| canary paths/doctor --json、version --plain/--json | runtime schema 与字段断言通过                         | 完整检查中的 r0-ci.test.ts 及结构化记录                                      |
| 219 个源码/脚本/配置文件 SHA-256 前后比对          | 无变化；包含受跟踪和本轮新增文件                      | 结构化记录 sourceHashes 与最后一项检查                                       |
| git diff --check                                   | 无空白错误                                            | 最终收尾执行                                                                 |

最后一次 launcher CI runId：**run_767ef928-a4ea-4f38-9fa7-fe113e999a00**。每次验收独立生成 runId；历史执行未被覆盖。ci.json、run.json、report.json、report.xml 的 SHA-256 在结构化记录中保留，实际运行产物位于被 Git 忽略的 .canary/artifacts 中。记录内临时 launcher 路径在验收结束后已清理，用户 PATH/注册文件未变更。

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
| isolation      |       5 |
| hard-evolution |       6 |
| runner         |      16 |
| loop           |       6 |
| control-plane  |      25 |
| web            |      16 |
| cli            |      79 |
| **合计**       | **264** |

其中 r0-ci.test.ts 为 25 个实际子进程/fixture 测试，r0-contracts.test.ts 为 14 个契约与故障注入测试；不能把 mock/fault 注入称为真实满盘、旧 Node 或跨平台验收。typecheck 按仓库现有 tsconfig 检查 src；测试文件由 Vitest 实际运行，不声称另做了全测试文件静态类型检查。

### 调试期间发现并修复的问题

初次全量失败保存在 [原始失败日志（归档）](logs/README.md)，不是最终状态：

1. Vitest 中 import.meta.resolve 不可用，改用 createRequire + file URL 解析测试 loader。
2. Windows 临时目录的 8.3 短路径与 realpath 后长路径不一致，测试 fixture 和授权上下文改用实际路径，没有撤销路径规范化来“过测试”。
3. Windows 环境变量键不区分大小写，旧 npm_package_name 与测试覆盖键可同时出现；测试先规范清理继承键，launcher 也清理相关键。
4. 旧测试仅设置 INIT_CWD 但未通过真实包脚本调用，改为显式 --config；生产解析器只允许指定包脚本和执行位置使用 INIT_CWD。
5. 原 launcher 从独立用户项目解析 tsx 会依赖错误的模块根，已改为构建后的 CLI；真实生成的 launcher 在带空格项目中通过。
6. 根 README 原格式门禁失败已修复，没有关闭 format:check 或降低门禁。

## 4. 验收状态矩阵

| 场景                                                                | 状态     | 精确边界                                                            |
| ------------------------------------------------------------------- | -------- | ------------------------------------------------------------------- |
| Windows 11 / Node 24.18.0 / pnpm 10.15.0 的 R0 命令契约             | verified | 仅上列命令及测试范围                                                |
| 路径空格、独立 invocation/project/install 目录、非默认 home fixture | verified | 临时 HOME/USERPROFILE 与注册文件；不等于创建真实 OS 用户或 ACL 矩阵 |
| Windows junction / 短路径规范化                                     | verified | home.test.ts 实际本地文件系统测试                                   |
| 0/1/2/3/5/6 实进程结果                                              | verified | 正常、失败、配置错误、超时、artifact 文件占位、policy violation     |
| 4/10 错误信封与最终化恢复                                           | verified | typed fault/cleanup 注入；不冒充完整环境故障矩阵                    |
| Ubuntu / macOS / Node 22 兼容                                       | declared | 本轮没有目标环境执行证据                                            |
| Windows 全分发 clean install/upgrade/uninstall/offline              | declared | 没有真实执行安装升级；临时 launcher 测试不是安装认证                |
| 真实满盘、进程树强杀、断电与机器重启恢复、长跑容量                  | declared | 属于 R1/R3/R7 的后续验收                                            |
| CI 自动运行任意 Node/Python/Go/Rust 仓库脚本                        | declared | R4，当前 capabilities.scope 明确为 configured-agent-cases           |
| 远端 GitHub Actions 本轮运行                                        | excluded | 用户明确不以当前 GitHub CI 经费作为门槛；不影响本地验收             |
| 六格常驻 CI、npm/签名/SBOM/外部生态产品化                           | excluded | 已移出当前个人开发者目标                                            |

本轮没有阻塞 R0 的外部依赖，因此不人为制造 blocked；后续明确依赖缺失且无法执行的验收再记录 blocked 与可复现原因。

## 5. 与总文档的一致性审计

| 必查项            | 结论                                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| 本地优先/自动外发 | 保持；新增 CI 路径没有启用 exporter，不自动上传或使用模型凭证。配置仍是可信可执行代码，不等于网络沙箱           |
| 原始数据暴露      | 没有新增原始 input/output 到 CI envelope；控制台重定向沿用脱敏器，异常诊断不回显任意秘密。全量持久化隐私仍属 R3 |
| 根目录混淆        | 取消隐式安装 Demo；只有 Canary 自测可有意使 projectRoot=installRoot；artifact 集合保持项目归属                  |
| verified/declared | 去掉旧声明脚本的伪 verified；Windows 证据不外推三平台或 clean install                                           |
| 生态适配过度宣传  | 不宣称完成外部 provider 生态或多语言全项目 CI                                                                   |
| 循环自动启动      | 没有改变；run --ci 不启动 loop/自治                                                                             |
| 异常可审计        | 配置/运行/最终化错误有固定信封和分类；运行中异常可能尚未返回 runId、强杀可能来不及输出，明确留给 R1/R3          |
| 个人维护成本      | 延用 pnpm、现有 Zod/Vitest 与源码 launcher，没有新增依赖、云服务或发布供应链                                    |

对初稿只做了必要的契约对齐：artifactRoot 保留历史集合含义；canary.config.ts 保持现有默认格式；普通 run 保持 0/1；R0 只实现当前 Agent case CI。没有把 R2/R4 的完整目标删除或假装已完成，详见 [R0 契约](../guides/r0-cli-contract.md)。

## 6. 回滚与下一阶段

本轮没有修改用户安装元数据、长期 PATH 或既有 launcher，也没有提交 Git。回滚应先备份工作区 diff，再仅撤回本记录列出的 R0 文件变更并重新 pnpm build；不要清空 .canary、删除历史证据或用 git reset --hard 覆盖后续用户工作。ci.json 是新增文件，旧 run.json 与 report 格式仍可读取。

下一阶段严格进入 R1：

1. 以 pnpm build、pnpm check、pnpm verify:r0 作为不得退化的入口基线。
2. 统一 runner 状态迁移、超时/取消/预算终止和错误分类；保留预期失败用例语义。
3. 隔离 cwd、端口、临时目录、环境和锁；验证重复/并发执行互不覆盖。
4. 加入子孙进程终止与资源释放证据；分开 Windows 与 Unix 的真实验收。
5. 持久化失败/checkpoint/恢复关联，验证中断后已完成结果不丢失，再更新 R1 执行记录。

R2 完整诊断、R3 artifact/隐私、R4 通用 CI、R5 页面、R6 三平台/Agent fixture、R7 长跑手册、R8 受控软进化仍按唯一路线图顺序推进。
