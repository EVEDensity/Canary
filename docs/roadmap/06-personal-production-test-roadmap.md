# Canary 个人开发者生产级测试路线图

> 版本：1.1（R0 契约冻结）
> 更新日期：2026-09-16
> 状态：新的唯一执行基线

本文档取代此前围绕 L-03、分发产品化、外部观测和六格 CI 矩阵的后续安排。旧文档仍保留在 docs/roadmap/ 与 docs/archive/ 中，用于追溯设计历史，但不再作为实施清单。后续代码、测试、文档和验收均以本文档为准。

## 1. 最终定位

Canary 的目标不是 npm 分发平台、云端观测平台或自动修改一切代码的 Agent。它是一个面向个人开发者的、本地优先的 Agent/应用测试工作台，负责：

- 在用户指定的项目根内发现项目、配置和测试入口；
- 稳定地运行命令、HTTP、进程、文件系统、容器和 Agent 检查；
- 在超时、取消、进程崩溃、重复执行和部分失败时保留可解释状态；
- 生成可复现、可校验、可脱敏、可审计的本地证据；
- 通过 canary run --ci 提供适合自动化门禁的无交互检查；
- 通过 canary run 提供更全面的本地诊断和报告页面；
- 在用户主动授权后，为 pi 等开源 Agent 提供可复用的测试 fixture；
- 为后续 Skill/软进化提供事实反馈，但不把自动修改源码或自动外发作为默认行为。

“生产级”在本文中指测试工具本身具备可预测、可恢复、可审计和隐私可控的行为，不表示 Canary 能保证被测 Agent 业务正确，也不表示已认证所有操作系统、宿主或第三方生态。

## 2. 不可违反的产品原则

1. **本地优先**：项目代码、运行日志、artifact、trace 和报告默认只写本地；不启用网络 exporter 时不得产生自动外发。
2. **根目录分离**：projectRoot 是被测项目；installRoot 是 Canary 安装/运行时目录；artifactRoot 是项目的历史运行集合目录，单次产物位于 artifactRoot/runId；invocationRoot 是用户执行命令的位置。任何根目录不得因缺省值而互相替代。
3. **证据优先**：通过、失败、阻塞、未执行都必须有状态和原因；测试数量不等于验证完成。
4. **失败可恢复**：取消、超时、崩溃和机器重启后，已完成的结果不能被静默覆盖；重复运行必须可区分且幂等。
5. **默认不自治**：Canary 不安装即自启循环，不寻找未授权的模型凭证，不自动修改用户项目，不自动上传原始输入输出。
6. **声明不冒充实测**：未在真实目标环境执行的支持项只能是 declared；无法执行但有明确外部依赖的是 blocked。
7. **最小个人维护面**：优先实现跨平台行为、稳定契约和本地体验，不建设个人开发者无法持续维护的发布供应链。

## 3. 支持边界

### 3.1 三平台方案

正式支持三类操作系统：

| 平台          | 首要验证目标       | 关键差异                                                      |
| ------------- | ------------------ | ------------------------------------------------------------- |
| Windows 10/11 | 主开发、主回归平台 | 反斜杠路径、盘符、ACL、进程树、PowerShell、文件占用、终止语义 |
| Ubuntu LTS    | Linux 正式支持平台 | 正斜杠路径、权限位、信号、shell、进程组、容器可用性           |
| macOS         | macOS 正式支持平台 | BSD 用户态、权限提示、shell、路径和进程终止差异               |

三平台的必要性来自文件系统、权限、进程、信号、shell 和路径语义不同。它们验证的是 Canary 的系统边界，而不是为了追求 CI 表格数量。

### 3.2 Node 版本策略

仓库当前声明 node >=22。因此运行时策略为：

- Node 24：主验证版本，所有三平台的发布前验收必须覆盖；
- Node 22：兼容性验证版本，在发布前或周期性回归中覆盖，不作为个人开发者每次提交都运行的常驻矩阵；
- Node 低于 22：明确 excluded；
- pnpm 版本以仓库 packageManager 字段为准，不能由测试机隐式升级。

不强制维护 ubuntu-latest × Node 22/24、windows-latest × Node 22/24、macos-latest × Node 22/24 六格常驻矩阵，原因如下：

1. 每格组合并不能替代真实的路径、权限和进程故障注入；
2. 个人开发者承担六格常驻维护成本，收益低于针对性三平台回归；
3. latest 是会漂移的托管镜像标签，不能作为可复现证据；
4. Node 22/24 是运行时兼容性维度，应与操作系统行为测试解耦；
5. 当前本地 Windows Node 24 证据不能推导 Ubuntu 或 macOS 已验证。

验收记录必须写明操作系统版本、Node 版本、pnpm 版本、shell、项目路径和执行日期。没有真实环境证据时，状态只能写 declared 或 blocked。

### 3.3 被测项目类型

Canary 不为 AgentHub 写死。项目发现和命令编排应以适配器为边界，首批支持：

| 类型            | 默认发现/检查                                                | 状态                          |
| --------------- | ------------------------------------------------------------ | ----------------------------- |
| Node/TypeScript | package.json、pnpm/npm scripts、typecheck、test、lint、build | verified 以实际 fixture 为准  |
| Python          | pyproject.toml、pytest、ruff、mypy/pyright                   | declared，需真实 fixture 验证 |
| Go              | go.mod、go test、go vet                                      | declared，需真实 fixture 验证 |
| Rust            | Cargo.toml、cargo test、cargo check                          | declared，需真实 fixture 验证 |
| Docker/Compose  | 配置解析、服务健康和日志采集                                 | declared，依赖本机 Docker     |
| Agent/MCP       | fixture 声明的启动、工具调用和结果断言                       | 按 fixture 单独记录           |

AgentHub 只是复杂多语言样本，不是架构规范。它当前的测试收集和若干服务测试存在失败，后续只能作为 blocked/failed 的真实样本记录，不能反向要求 Canary 内置所有其基础设施。

## 4. 两种运行模式

### 4.1 canary run --ci

这是全局、稳定、可嵌入自动化的自检门禁。目标用法是从任意被测项目根执行 canary run --ci。

必须完成：

- 自动发现或明确读取项目配置；
- 执行轻量 doctor/preflight；
- 校验 Node、pnpm、配置、项目根、artifact 根和写权限；
- 按配置运行必需检查；
- 记录命令、cwd、环境白名单、耗时、退出码、stdout/stderr 脱敏摘要；
- 写出 JSON、JUnit（如启用）和可校验 artifact manifest；
- 返回稳定退出码；
- 不打开浏览器、不等待人工输入、不自动修改项目、不自动外发；
- 在自身配置错误时给出可执行的修复建议。

建议退出码：

|  码 | 含义                                        |
| --: | ------------------------------------------- |
|   0 | 所有必需检查通过                            |
|   1 | 被测检查失败                                |
|   2 | 项目发现、配置或 schema 错误                |
|   3 | 超时、取消或预算耗尽                        |
|   4 | Node、pnpm、Docker、端口等环境/基础设施错误 |
|   5 | artifact 写入或完整性错误                   |
|   6 | 隐私或策略门禁失败                          |
|  10 | Canary 内部错误                             |

R0 固定 --ci 的 stdout 为单行 v1 JSON，包含摘要、退出码与 artifact 路径；诊断日志写 stderr。它是自我排查入口，不是“无条件把整个仓库所有脚本都运行一遍”。未声明的检查不能被偷偷升级为必需门禁。

### 4.2 canary run

这是面向开发者的全面检查入口。它可以：

- 运行必需检查和可选检查；
- 进行服务、Docker、端口和依赖健康检查；
- 支持失败项重试、单项重跑和历史结果比较；
- 输出更完整日志和修复建议；
- 启动只监听 127.0.0.1 的本地报告页面；
- 在交互终端中展示进度，但不改变测试结论。

普通 run 的额外诊断不能改变 --ci 的退出码语义。浏览器自动打开应可通过 --no-open 关闭，CI 模式默认不打开浏览器。

## 5. 配置与根目录契约

配置文件应明确声明：

- projectRoot 或相对于 invocation root 的项目目录；
- artifactRoot；
- 检查列表及类型；
- required/optional；
- cwd、超时、重试和取消策略；
- 允许传入的环境变量名，而不是整个环境；
- stdout/stderr 脱敏规则；
- platform selector；
- Agent fixture 和凭证需求；
- 是否允许用户主动启用网络检查。

R0 已冻结的路径契约（替代初稿建议）：

- invocationRoot = 用户执行命令时的绝对路径；
- projectRoot = 配置解析后的被测项目绝对路径；
- installRoot = Canary 源码安装/运行时目录；~/.canary/home.json 是注册文件，不是被测项目；
- artifactRoot = projectRoot/.canary/artifacts；单次目录 = artifactRoot/<run-id>；
- configFile = 向上发现的 canary.config.ts 或显式 --config；.canary/config.* 不在 R0 实现范围。

projectRoot 优先级是显式 --config > 最近祖先配置 > 调用目录（缺配置报错）；永不隐式回退安装 Demo。Canary 自测时 projectRoot 与 installRoot 可相等。完整 CLI/schema/退出码和兼容边界见 [R0 契约](../guides/r0-cli-contract.md)。本节其余配置字段与全面诊断属于后续阶段目标，不代表已全部实现。

诊断必须检测并报告：配置不存在、安装元数据损坏、launcher 缺失、项目根与安装根冲突、artifact 根不可写、路径包含空格、非默认用户目录以及符号链接/大小写造成的根目录别名。

## 6. 本地报告页面

普通 canary run 可启动 http://127.0.0.1:<port>。

页面必须展示：

- invocation root、project root、config file、artifact root、install root；
- Canary、Node、pnpm 版本和 launcher 路径；
- 总检查数、通过/失败/阻塞/跳过数量；
- 每项耗时、实时日志、错误详情和修复建议；
- artifact manifest、脱敏摘要、历史运行和上次结果比较；
- 超时、取消、重试、恢复和资源容量信息；
- 隐私扫描和外发状态。

安全边界：只监听回环地址，不读取其他项目的 artifact，不在页面显示 token/API key，不默认暴露局域网；页面服务停止后不影响已写入的本地证据。

## 7. 统一检查模型

检查执行器统一支持以下类型：command、http、filesystem、process、database、docker、agent。

每项至少需要：

- 稳定 ID 和版本；
- required/optional；
- platform selector；
- cwd 和超时；
- env allowlist；
- 期望退出码或响应断言；
- retryable 错误分类；
- cancellation 和 process-tree cleanup；
- stdout/stderr redaction；
- artifact 输出和内容 hash；
- verified/declared/blocked/excluded 证据状态。

执行器必须隔离测试临时目录、端口、环境变量、数据库 schema 和子进程。一个检查的失败不能污染下一项，也不能覆盖上一轮运行。

## 8. 证据与验收状态

| 状态     | 严格定义                                                 |
| -------- | -------------------------------------------------------- |
| verified | 在指定环境中真实执行，验收命令通过，保留可审计证据       |
| declared | 已实现或有设计承诺，但当前没有完整真实环境证据           |
| blocked  | 受缺失运行时、凭证、服务、平台或外部仓库阻塞，原因可复现 |
| excluded | 经产品决策明确不属于当前目标，不得作为未完成缺口追踪     |

每次运行证据至少包括：运行 ID、时间、Git ref/commit（如可用）、命令、绝对路径、版本、配置摘要、状态、退出码、耗时、artifact manifest、脱敏日志和失败分类。原始输入输出默认不进入跨运行长期存储。

## 9. 分阶段实施计划

### R0：基线冻结与契约清理

状态：**已完成（Windows Node 24 范围）**。证据见 [R0 执行记录](../evidence/r0-execution.md)；Ubuntu/macOS 与 Node 22 不据此标记 verified。

目标：让新规划和现有代码对齐。

交付：统一 projectRoot/installRoot/artifactRoot/invocationRoot；固定 run --ci、run、doctor、paths、version 的 CLI 契约；统一退出码和证据状态 schema；将旧路线图标记为历史参考；修复当前文档格式检查失败。

验收：Canary 自身可从仓库根执行 canary run --ci，配置错误时返回 2，且不会写入项目源码。

### R1：运行器稳定性与测试隔离

状态：**已完成（Windows Node 24 范围）**。证据见 [R1 执行记录](../evidence/r1-execution-record.md)；Ubuntu/macOS 与 Node 22 不据此标记 verified。

目标：解决生产测试工具最核心的进程和隔离问题。

交付：子进程树终止、超时、取消和孤儿回收；独立临时目录、端口、环境和工作目录；并发运行锁、重复执行去重和运行 ID；崩溃后可读取 partial run 并继续收尾；Windows、Linux、macOS 的路径和信号适配层。

验收：故意制造 hanging process、非零退出、重复启动、并发启动、锁残留和临时目录冲突，结果均可分类且不会污染其他运行。

### R2：配置发现与自我诊断

状态：待实施（下一阶段）。R0 已建立 roots、doctor/paths/version 的最小 schema 和部分缺失诊断；完整冲突/权限/修复验收仍未完成。

目标：让 canary run --ci 能自己找出“为什么没有正常测试”。

交付：配置文件发现优先级和显式 --config；canary doctor --json 标准 schema；canary paths --json 标准 schema；canary version --json 与纯版本输出；路径空格、非默认用户目录、根目录冲突和权限错误诊断；每个问题对应可执行修复建议。

验收：构造缺配置、坏配置、坏元数据、缺 launcher、不可写 artifact root、install/project root 冲突等 fixture，JSON 字段稳定，退出码符合定义。

### R3：artifact 完整性、可复现和隐私

目标：让结果可以被重新检查，而不是只能看一次终端输出。

交付：manifest、schema version、内容 hash 和运行谱系；脱敏、内容扫描和 secret/token 保护；固定时钟/随机源/环境摘要的可选录制；失败 artifact、重试 artifact 和恢复 artifact 的关联；本地保留策略和容量上限。

验收：相同 fixture 在固定输入下得到等价结论；修改 artifact 可被完整性检查发现；敏感字段不会出现在页面、摘要或默认长期存储中。

### R4：canary run --ci 全局门禁

目标：提供无需人工干预的项目级自检。

交付：项目发现器和语言适配器；command/http/filesystem/process/docker/agent 检查编排；机器可读 JSON、JUnit 和摘要输出；稳定退出码、超时预算、失败分类和 artifact 路径；默认不打开页面、不外发、不自动修复。

验收：Canary 自身、一个 Node fixture、一个 Python fixture 至少能通过 --ci；未知语言能返回明确的 declared 或 blocked，而不是误报通过。

### R5：全面 canary run 与本地控制面

目标：为个人开发者提供一次命令完成的全量排查。

交付：本地回环报告服务和页面；实时进度、日志、错误、建议、历史和比较；可选服务健康、Docker、资源和容量检查；失败项重试和单项重跑；--no-open、指定端口、只写 artifact 等开关。

验收：页面可在运行中访问；停止页面不丢失证据；多个项目之间不会串读数据；CI 与普通运行的结论一致，只是诊断深度不同。

### R6：真实三平台验证与 Agent fixture

目标：以真实项目和真实系统边界证明支持，而不是以静态声明代替。

交付：Windows、Ubuntu、macOS 的最小真实回归集；Node 24 三平台主验证；Node 22 发布前兼容验证；路径带空格、非默认目录、长路径、权限和并发 fixture；integrations/fixtures/ 下的 deterministic-agent、pi-agent、tool-calling-agent、http-agent、mcp-agent；每个 fixture 的来源、commit/tag、启动方式、凭证需求、offline 行为、期望输出和副作用声明。

验收：每个实际运行组合都有证据文件。无法安装依赖、需要用户凭证或平台不可用时记录 blocked，不改写为 verified。

### R7：长时间运行、容量和恢复

目标：验证个人长期使用时不会因日志、重试或崩溃失控。

交付：长时间运行和大量 case 的容量基线；artifact 保留、磁盘配额、日志轮换；断点恢复、机器重启、进程崩溃和半写文件恢复；并发上限、背压和资源告警；生产测试项目文档、运行手册和故障排查手册。

验收：在固定容量预算内完成长跑；中断后能继续或明确失败；不重复执行已确认完成的 case；恢复行为保留审计链。

### R8：受控 Skill/软自进化

目标：让 Canary 通过事实反馈帮助 Agent/宿主改善 prompt 和测试策略，而不是直接宣称自动进化。

交付：从失败分类、修复建议和历史比较生成结构化经验；经验版本、来源、适用 fixture 和回滚；作为 Codex/Cursor 等宿主可选择启用的 Skill；只注入与当前项目/检查相关的最小上下文；人工批准、离线回放和收益比较。

验收：同一 fixture 上，启用经验后的 prompt/策略变化可解释、可回放、可比较；没有模型或宿主时核心测试仍完整可用；不自动写源码、不自动寻找凭证、不把一次通过当作通用进化。

## 10. 当前状态与首批执行顺序

截至 2026-09-16：

| 能力                                                           | 当前状态                                     | 说明                                                                               |
| -------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------- |
| Canary 本地评估、trace、artifact、Web 控制面                   | verified（仓库内）                           | 已有历史证据，但仍需按新 schema 收敛                                               |
| 运行器超时/取消/预算、进程树、锁/tmp/port、checkpoint 恢复     | verified（Windows Node 24）                  | Ubuntu/macOS 与 Node 22 仍为 declared；见 [R1](../evidence/r1-execution-record.md) |
| 基础 CLI version/paths/doctor/run                              | declared                                     | 有实现，--ci 全局产品契约尚未完成                                                  |
| 三平台                                                         | declared                                     | 当前本地 Windows 证据不能代表 Ubuntu/macOS                                         |
| Node 24                                                        | verified（本地基线）                         | 需绑定实际命令和日期                                                               |
| Node 22                                                        | declared                                     | 尚未作为新路线图的完整兼容证据                                                     |
| AgentHub 适配                                                  | excluded（写死适配）/blocked（当前样本运行） | AgentHub 是样本，不是 Canary 架构要求；其测试存在收集阻塞和失败                    |
| pi 等开源 Agent fixture                                        | declared                                     | 需建立固定来源和离线/凭证边界                                                      |
| npm、独立 registry package、平台二进制、签名、SBOM、provenance | excluded                                     | 用户明确暂不考虑，不作为本路线图缺口                                               |
| 自动外发、云端观测、完整 Phoenix/Langfuse 生态适配             | excluded                                     | 不属于个人本地优先核心                                                             |

首批执行顺序固定为：R0、R1、R2、R3、R4、R5、R6、R7、R8。R8 只有在核心稳定后实施。

## 11. 每阶段一致性审计

每完成一个阶段，必须重新检查并在执行记录中回答：

1. 是否仍然本地优先，是否出现未授权自动外发；
2. 是否扩大原始输入输出、凭证或保留集的暴露面；
3. 是否混淆 installRoot 与 projectRoot；
4. verified/declared/blocked/excluded 是否准确；
5. 是否把基础适配宣传成完整生态支持；
6. 是否改变循环自动启动语义；
7. 失败、超时、取消和崩溃后是否仍可恢复和审计；
8. 新增能力是否超出个人开发者可维护范围。

阶段交付记录必须包含：基线 commit/环境、变更路径、行为变化、验收命令、真实输出、未覆盖边界和回滚方式。没有证据的项目不得标记为完成。

## 12. 生产级判断标准

当且仅当 R0-R7 的必需验收完成，并且三平台至少各有一套真实回归证据，Canary 才能称为“个人开发者可用的生产级测试项目”。R8 的软自进化不是生产级基础门槛。

在此之前，可以准确地称为：

> 已具备本地 Agent 评估和可审计控制面的工程原型，正在补齐跨平台运行器、全局 CI 门禁、恢复性和真实 fixture 验证。

这一定义避免把已有代码规模、CI 通过或单一 Windows 环境的成功，误认为整个项目已经完成生产级认证。
