# R0 CLI 与根目录契约（v1）

> 2026-09-16 冻结。实现与真实验收见 [R0 执行记录](../evidence/r0-execution.md)。后续唯一计划仍是 [R0–R8 路线图](../roadmap/06-personal-production-test-roadmap.md)。

## 范围与兼容边界

R0 固定现有 Agent case 执行路径的入口契约，不实现通用语言项目发现或自动运行任意仓库脚本。Node/Python/Go/Rust 等 required/optional 检查编排属于 R4。进程树清理、崩溃恢复和 tmp/lock/port 隔离已在 [R1](../evidence/r1-execution-record.md) 的 Windows Node 24 范围落地；Ubuntu/macOS 仍为 declared。当前仓库的 CI 配置运行 15 个本地示例 case，不等于执行完整的 pnpm check。

- run --ci：非交互、无 Web listener、不打开浏览器、不启用自动 exporter、不启动自治循环、不修改项目源码。
- 普通 run：保留既有 Agent 评估、可选本地 Web 页面与 0/1 退出码。--headless 禁用页面，--no-open 仅禁用打开浏览器。现有 run --json 输出不是新的 CI envelope。
- paths/doctor/version：使用下述 v1 输出；不再将三个命令输出混为一个对象。
- 配置和用例是**受信任的可执行模块**。这些约束不是 OS 沙箱，不禁止用户显式配置的 HTTP Agent，也无法阻止恶意模块自行写文件、联网或直接写 stdout。不要运行不可信配置。

## 四类 root

| 字段           | v1 含义与优先级                                                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| invocationRoot | 用户调用位置的绝对路径，保留路径别名；库调用可传 cwd。仅在 @canary/cli 包目录中运行 canary/dev 包脚本时使用 INIT_CWD，全局 launcher 清除继承的包脚本变量 |
| projectRoot    | 显式 --config 文件所在目录，优先于从 invocationRoot 向上找到的最近 canary.config.ts；没有配置则保持调用目录并报错，不回退安装 Demo                       |
| installRoot    | CANARY_HOME > 有效的 ~/.canary/home.json.root > 正在执行的源码仓库根；仅描述安装位置，不参与项目配置发现                                                 |
| artifactRoot   | projectRoot/.canary/artifacts，表示历史运行集合；单次运行目录是 artifactRoot/runId，artifactPath 指向其中 run.json                                       |

configRoot 当前等于 projectRoot；configFile 为绝对文件路径。已存在的项目、配置、安装目录使用 realpath 规范化，避免 Windows 8.3 短路径或 junction 别名产生不同 projectRoot；不存在的路径保持绝对形式以便诊断。不会仅靠字符串小写强行合并 Unix 大小写不同的目录。

projectRoot 与 installRoot 在 Canary 自测时允许相同；**禁止的是缺少项目配置时隐式使用安装 Demo**，不是禁止所有相等路径。R2 将外部调用选中安装配置诊断为 `PROJECT_INSTALL_CONFLICT` warning，并报告不可写 artifact 与路径异常；仍不自动改写用户文件。

当前默认配置仍是 canary.config.ts；不声称已支持 .canary/config.* 或任意 artifactRoot 配置。原路线图中的这些建议不能冒充已实现行为。

历史 source=install 值只保留在旧 TypeScript 类型中供历史消费者识别；新 projectContextSchema 不接受它。老 artifact 不被重写。历史授权/经验若绑定了路径别名，可能因 canonical projectRoot 不同而拒绝使用；不得静默重新授权，应保留记录并按规范路径重新确认，自动迁移不在 R0。

## 命令与机器输出

安装后可运行（源码开发可用 pnpm canary 代替 canary）：

```sh
canary run --ci
canary run --ci --config "/path with spaces/canary.config.ts" --case smoke
canary run --ci --tag smoke --tag regression --repetitions 2
canary paths --json --config "/path with spaces/canary.config.ts"
canary doctor --json
canary version --plain
canary version --json
```

CI 只接受 --ci、--json、--headless、--no-open 及带值的 --config、--case、--tag、--entry、--repetitions。仅 --tag 可以重复；repetitions 必须是正安全整数。--entry 相对 projectRoot，--config 相对 invocationRoot。未知参数、缺值、零用例、不匹配过滤器、重复 case ID、缺失 function entry 均返回 2。CI 不接受 --port。

直接 CLI 的 stdout 固定为一行 JSON（有无 --json 都相同）；受控 console 日志经现有脱敏器转到 stderr。使用 pnpm 包装时 pnpm 本身会打印脚本前缀，自动化需要纯 JSON 时应直接调用 launcher 或构建后的 packages/cli/dist/index.js。

成功完成执行后强制保留 JSON 和 JUnit 报告，即使项目原来只选择 console reporter；另用独占临时文件 + rename 写入 ci.json。该 rename 仅为完成信封写入，不代表整个 artifact 已有断电一致性保证（R3/R7）。写入失败不得返回假成功。

### 可执行 schema

权威定义和导出在 packages/core/src/cli-contracts.ts，使用 Zod runtime 校验。v 固定为 1；不兼容变更需要显式版本升级。

| kind / schema                        | 字段                                                                                                                                                                 |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| canary.ci / ciResultSchema           | v、kind、mode=ci、context、exitCode、outcome、runId、artifactPath、summary、issues、runtime、capabilities                                                            |
| context / projectContextSchema       | v、四类 root、configRoot、configFile、source=config/walk/cwd；路径为当前 OS 的绝对路径；installRoot 在兼容类型中可选，现有 resolver 总会提供                         |
| summary                              | total、passed、failed，非负整数，passed+failed 不得超过 total；取消时未完成项不伪装成通过                                                                            |
| issues                               | code、severity=error/warning、message、suggestion；不打印任意异常栈中的凭证                                                                                          |
| runtime / canary.version             | v、kind、canaryVersion、nodeVersion；Canary 版本取实际可执行包，不信任安装元数据的版本                                                                               |
| capabilities                         | scope=configured-agent-cases、web=false、automaticExport=false，防止误解为已经实现全项目 CI                                                                          |
| canary.paths / pathsSnapshotSchema   | context 的扁平字段 + kind；不执行配置、不启动评估、不探测网络                                                                                                        |
| canary.doctor / doctorSnapshotSchema | paths 字段 + canaryVersion/nodeVersion/pnpmVersion/launcher/metadataStatus/exporter/localFirst/exitCode/issues/problems/suggestions；problems/suggestions 为兼容字段 |

预检失败时 runId/artifactPath 为 null，summary 为零。执行中途异常若已写入 `checkpoint.json`，`run --ci` 会按当前 pid 关联 partial run，并在信封中带回 runId/artifactPath 与已完成计数；不能把没有 checkpoint 的崩溃当成从未开始。artifact 完整性哈希与半写文件恢复仍属 R3/R7。

### 退出码与优先级

| 码  | v1 语义                                | 当前证据                                                                                                                     |
| --- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 0   | 配置的必需 case 与现有质量门禁通过     | 实际执行                                                                                                                     |
| 1   | 被测 case、覆盖率或其他行为门禁失败    | 实际执行                                                                                                                     |
| 2   | CLI 参数、配置、用例发现或 schema 错误 | 实际执行                                                                                                                     |
| 3   | 非预期超时、取消、预算终止             | 真实超时 + CI 取消映射；Windows 进程取消矩阵见 [R1 执行记录](../evidence/r1-execution-record.md)；Ubuntu/macOS 仍为 declared |
| 4   | 环境/基础设施错误                      | typed fault 注入；Node<22 预检，不能声称已跑旧 Node/Docker 故障矩阵                                                          |
| 5   | artifact 写入或最终化失败              | 文件占位故障 + 最终化错误测试；真实满盘未执行                                                                                |
| 6   | 隐私/策略门禁失败                      | 真实 policy.violation case；全面隐私扫描留 R3                                                                                |
| 10  | Canary 内部错误                        | typed fault / cleanup 故障注入                                                                                               |

outcome 与 exitCode 固定对应：0=passed，1=failed，3=interrupted，其余=error。已执行 run 的选择优先级是策略门禁 > 非预期中断 > 其他检查失败 > 成功；最终化/cleanup 的基础设施错误可覆盖先前执行结论，并在 issues 中明确原因。作为用例预期且断言通过的 timeout 不误报为退出码 3。

verified/declared/blocked/excluded 是**验收证据状态**，不是 case 运行结果；不可将 passed/failed 当成平台验证状态。

## 诊断与修复边界

paths 即使配置不存在也可输出定位结果并返回 0，且不执行配置模块。doctor 对缺配置或 schema/导入失败返回 2；仅不可写 artifact 且无配置错误时返回 5。损坏元数据、注册 launcher 缺失、安装目录异常、pnpm 不可用、路径空格、非默认用户目录、junction/符号链接别名、以及调用目录在安装根之外却选中安装配置，均为有建议的 warning。不自动改写用户文件。pnpm 探测仅运行本地 --version，3 秒超时。未登记全局安装不妨碍源码 CLI 使用。

R2 起 doctor 会导入受信任的 `canary.config.ts` 做 schema 与 function entry 存在性检查，导入期间静默 `console.*`，不把异常栈中的密钥打印到 stdout。这不是 OS 沙箱，也不自动修复元数据。exporter.enabled=false 表示默认命令没有启用 exporter，不是对任意用户可执行模块网络行为的审计结果。

## R1 的可验证起点

```sh
pnpm build
pnpm check
pnpm verify:r0
```

verify:r0 生成临时 launcher，只修改子进程 PATH，不安装全局、不改写用户 home.json；从仓库根调用真正的 canary run --ci，验证缺配置退出码、诊断 schema、pnpm 调用目录和受跟踪及新增源码/脚本 SHA-256 不变。它会在仓库 .canary/artifacts 新建独立运行，保留证据；临时 launcher 随后清理。使用 node scripts/verify-r0.mjs --out <file> 可保存结构化记录。

R1 修改运行器后必须保持本契约回归通过，并保留进程树取消、锁/端口隔离、并发重复执行、部分失败持久化、checkpoint 与恢复测试。R0 的一次通过不能代替这些验收；Windows 证据见 [R1 执行记录](../evidence/r1-execution-record.md)。

## R2 的可验证起点

R2 必须保持上述 v1 schema 与退出码，并额外用 fixture 证明：缺配置、坏配置、坏元数据、缺 launcher、不可写 artifactRoot、install/project 冲突的 JSON 字段稳定且建议可执行。Windows 证据见 [R2 执行记录](../evidence/r2-execution-record.md)。Ubuntu/macOS 与 Node 22 仍为 declared。
