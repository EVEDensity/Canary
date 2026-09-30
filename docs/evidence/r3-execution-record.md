# R3 证据链：执行记录

状态：**已完成 R3 当前范围（Windows Node 24）**。执行日期：2026-09-19（Asia/Shanghai）。其他平台和 Node 22 不由本次本机结果推导为 verified。

## 1. 范围与基线

- 基线 commit：`c0cceda`；开始时 Git 工作区干净。
- 项目路径：`C:\Users\temp-admin\Desktop\Canary`。
- 目标：artifact manifest、内容哈希、运行谱系、完整性读取门禁、持久化与页面脱敏、损坏/截断/敏感数据 fixture、可复现元数据和显式历史清理。
- 可改路径：core 契约；trace 存储；runner 恢复与 context 时钟/随机；CLI 运行和派生产物；Web 输出；相关测试、验收脚本及文档。
- 兼容边界：保留 CI/JSONL v1 顶层契约；旧运行可读取但不标 verified；普通 run 的既有成功/失败语义保持；`verify` 为新的完整性命令。
- 验收：`pnpm build`、`pnpm check`、`pnpm verify:r0`、`pnpm verify:r3`，新增 fixture 覆盖 HTTP/SSE、恢复和隐私漏写。
- 停止条件：实现、必需验收、原始输出和当前文档同步完成。

## 2. 实际变更

- core 定义 manifest v1、RunEvidence、运行谱系和可复现/保留配置；隐私失败保持 CI 6。
- trace 增加原子写、文件字节哈希、manifest 历史链、完整性校验、统一脱敏、尾行恢复、保留计划和显式清理。
- CLI 封存前完成 trace 与资源清理；CI、比较、建议和宿主 proposal 的派生写入更新哈希链；增加 `verify`、`prune`、`--retry-of`。
- runner 恢复保留已有结果与待执行项，记录恢复前状态和尾行哈希；Function context 支持可选固定时间/随机源。
- Web 展示完整性及谱系，HTTP/报告/SSE 使用脱敏边界，磁盘篡改后拒绝继续返回该运行的正常详情。

## 3. 主线一致性检查

本轮所有变更服务于 R3。runner 依赖 trace 是为了复用恢复和证据写入；宿主 proposal 和控制面改动只补输出边界。没有启用自动循环或外发，也没有增加跨语言编排、云服务、OS 沙箱、签名分发或自动源码修改。

历史清理通过配置和 `prune --apply` 显式执行；运行时配额与长跑仍属于 R7。固定时钟/随机源只通过 Function context 提供，未将外部服务或全局时间宣称为确定性。

首次回归中的 CI 目录缺失问题已修正；旧恢复测试原先改写封存文件来模拟崩溃，现改成独立 partial fixture，继续断言完成结果不丢失。初期重复脱敏扫描引入耗时，已收敛为单次收集后遍历；没有提高旧测试超时阈值或降低门槛。

## 4. 验收结果

真实环境：Windows 11 25H2（10.0.26200），Node 24.18.0，pnpm 10.15.0，PowerShell 7.6.5；启动器验收由 Node 启动 cmd.exe。沿用已有依赖，并执行 offline install 链接 runner 到已有 trace 包，没有新增第三方运行时依赖。

| 验收             | 结果                                                           | 证据                                                                        |
| ---------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `pnpm build`     | exit 0                                                         | [构建日志（归档）](logs/README.md)                                          |
| `pnpm check`     | typecheck、319 tests、lint、format 通过                        | [全量检查（归档）](logs/README.md)                                          |
| 相关包测试       | trace 19、runner 31、web 16、cli 103 通过                      | [相关包日志（归档）](logs/README.md)                                        |
| `pnpm verify:r0` | 临时全局启动器与 pnpm 两轮均 15/15，旧 CI v1/根目录/退出码保持 | [结构化记录](logs/r3/r3-r0-acceptance.json)、[输出（归档）](logs/README.md) |
| `pnpm verify:r3` | 12 项真实 CLI/恢复/隐私/不改源码检查 verified                  | [结构化记录](logs/r3/r3-acceptance.json)、[输出（归档）](logs/README.md)    |

相较 R2 的 300 项全仓测试，R3 新增 19 项：trace 14 项、CLI 5 项。覆盖 manifest 字节哈希、派生写入历史链、修改/丢失/截断/额外文件、manifest 删除/损坏、历史链损坏、旧格式读取、原子替换失败、JSONL 尾行/中间损坏、结构化与无标签已知凭据、保留策略、CI 封存、重试/回放谱系、固定时钟/随机源、HTTP/SSE 脱敏、恢复和 CI 5/6 分类。

R3 真实验收在带空格的临时项目中执行，之后仅删除该脚本自己创建的目录；完整结构化摘要保留。R0 两轮验收的项目内 artifact 保留在 `.canary/artifacts/`。两套验收均核对 237 个源码/脚本/配置文件，运行命令没有改写这些文件。

初次完整检查在 319 项测试通过后因 `no-unsafe-finally` 失败，见 [初始记录（归档）](logs/README.md)。已将收尾逻辑提取为明确的 finalize 步骤，保留 artifact 失败传递到 CI 的行为；未禁用 lint 规则。

## 5. 边界与回滚

Ubuntu/macOS、Node 22、真实掉电、只读挂载和满盘尚无本轮实测。哈希链不提供签名认证。无标签、拆分或编码的任意秘密不能承诺自动识别。受信 Agent 自行绕过框架访问其他目录的能力未改变。

中间 JSONL 损坏、无法解析的 run.json 或已封存文件篡改会明确失败；不自动伪造结果或重算哈希掩盖损坏。更完整的异常存储恢复与长期容量验证仍属于 R7。

回滚时仅撤回本轮代码和文档变更并重新 build；保留全部历史运行目录。旧代码可忽略新增 evidence 字段，但没有 R3 校验能力；不能通过删除 manifest 或 artifact 来回滚。
