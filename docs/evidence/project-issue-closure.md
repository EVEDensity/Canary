# 项目问题闭环与 R6 补验

日期：2026-09-21（Asia/Shanghai）。基线 commit：`29cad55e0d36fb63c5c95b3d0b03b9d560f61a63`，保留用户已有 UI 修改。

## 已完成的闭环

- “改进建议”中增加项目问题汇总，按测试断言、配置、环境、依赖、超时、预算、平台、证据和质量门禁等类别筛选。关联 Agent 子运行的失败用例与门禁一并列出。
- 每个问题展示错误摘要、排查建议、错误证据入口和适用时的单项重跑入口。建议来自本地规则，不自动修改代码，不调用模型。
- 重跑状态由 artifact 派生：待处理、验证中、重跑仍失败、重跑已验证、验证证据不足。校验来源 manifest、retryOf/父哈希、检查配置、必需依赖与重跑封存状态。无关运行通过不会关闭问题。
- 重跑成功只证明对应检查的范围通过。原运行的失败状态和原始文件不改写。Agent 旧建议的人工确认与项目重跑验证分开，页面不再提供容易混淆的“标记已验证”操作。

主要变更：`apps/web/src/project-issues.ts`、`workspace.ts`、`workspace-ui.ts`、`dashboard-ui.ts`、`studio-styles.ts`。

## 错误证据和脱敏

`DiagnosticOutput` 替代超过 64 KiB 即整段丢弃的行为。stdout/stderr 各保留有界的开头、错误附近和末尾上下文，持久化为 `outputEvidence` 行数组；单行最多 1600 字符，每个流保留量小于 70,000 字符。过长单行整行省略，摘要不超过 1900 字符；保留策略及截断标志明确记录。

完整行先脱敏再选择摘要；分块传入的密钥、环境凭据、Bearer、私钥块与多行凭据边界均有回归。RunStore、私有文件写入、封存扫描和 Web 输出继续脱敏。日志数组随 run/checks/report JSON 进入 manifest 哈希验证。抽屉和检查详情展示保留上下文，并从中提取文件行号。

旧运行已省略的内容无法恢复；显示证据不足，不虚构根因。脱敏仍是已知凭据和模式检测，不能保证识别任意未知敏感文本。新策略保留更多有界诊断内容，未启用无限日志或原始分片转发。

主要变更：`packages/cli/src/diagnostic-output.ts`、`check-executor.ts`、`index.ts`、`packages/core/src/checks.ts`。Agent 子进程的机器 JSON 单独限长解析，避免诊断摘要破坏协议。

## 验证

- 构建和 typecheck 通过：[构建](logs/issue-closure/issue-closure-build.txt)、[typecheck 所在的首次完整检查](logs/issue-closure/issue-closure-check.txt)。
- 全仓按包顺序执行 **363 项测试通过**：[完整测试](logs/issue-closure/issue-closure-tests-serial.txt)。包含真实进程噪声输出→封存→Web API、跨分块脱敏、谱系、配置不匹配、缺失依赖、损坏及半写入重跑证据，以及真实修复→重跑→原问题验证关联。
- 首次并行全仓检查中，既有 R1 的 400 ms 超时 fixture 在创建孙进程前超时，缺少 `grand.pid`；原始失败保留。独立 12 项复核通过：[复核](logs/issue-closure/issue-closure-runner-retest.txt)，随后全套按包顺序通过。未放宽超时或删除断言。
- lint 通过：[日志](logs/issue-closure/issue-closure-lint.txt)。页面脚本语法、读写鉴权、项目隔离和脱敏 API 通过自动化验证。格式检查见 [日志](logs/issue-closure/issue-closure-format.txt)；两份被 SHA-256 引用的原始 Pi JSON 在 `.prettierignore` 中按精确路径保留字节，其余新文档及报告正常格式化。
- R6 四个可用平台组合各 10 项通过，Pi 真实推理一次通过。当前阶段状态及解除条件：[R6 状态](logs/r6/r6-closure-status.json)。

## 主线审计与边界

工作顺序仍是 R4/R5 问题闭环 → R6 真实证据。没有启动 R7/R8、自动修复、循环训练或远端 CI 发布。唯一模型调用由用户本轮明确提供 DeepSeek 凭据后执行，只发送固定 smoke prompt，不发送仓库代码；模型凭据不持久化。

R6 仍缺 macOS 和原生 Ubuntu 主机证据，因此阶段保持 blocked。已有恢复机制不等于完成 R7 长跑/容量验收。保留原始失败和所有历史验收文件；回退时撤回本轮新增问题派生和输出保留逻辑，不修改历史 artifact。
