# R6 平台和 fixture 执行记录

状态：**部分完成，阶段验收仍阻塞**。更新日期：2026-09-21（Asia/Shanghai）。

后续范围决定：用户已将 macOS 与原生 Ubuntu 验收延后至开源后的 CI。以下历史 blocked 表示当次缺少证据，不再阻塞当前 R7 初步维护；完整三平台支持仍不得据此宣称 verified。日志已按阶段归档，原始报告内容与哈希保持不变。

## 2026-09-21 问题闭环后的当前验收

先完成 [项目问题汇总、错误保留与重跑验证](project-issue-closure.md)，再补 R6。四组各 10 项真实检查通过，绑定同一源码树哈希 `d71cf5a9b59f4cef71853bc8a81f6b55ebcccc0c10c826c857c7d1f703771a82`：

- [Windows Node 24.18.0](logs/r6/r6-closure-win32-node24.json)、[Windows Node 22.23.2](logs/r6/r6-closure-win32-node22.json)。
- [Ubuntu 22.04 Docker 非 root Node 24.15.0](logs/r6/r6-closure-linux-node24.json)、[Node 22.23.2](logs/r6/r6-closure-linux-node22.json)。

对应 txt 保留原始日志；容器 `canary-r6-closure-20260921` 已退出（exit 0），原始导出位于 `.canary/runs/r6-closure-evidence/`。没有停止其他项目容器。

重新安装并核对官方固定 Pi 包的版本和 SHA-512 integrity，真实 CLI 探测通过：[运行时报告](logs/r6/r6-closure-pi-runtime.json)。用户明确提供 DeepSeek 测试凭据后，以 Pi SDK 0.86.0 经 Canary function adapter 实际执行一次 `deepseek-flash`：HTTP 200，输出 `CANARY_PI_R6_OK`，精确输出断言及轨迹断言通过，manifest verified；输入 68、输出 7、共 75 token。请求仅含固定短提示，无工具或项目代码，最多一次请求及 128 输出 token；未报告未知的货币费用。

初次验收脚本把 Pi 自动创建的空 `auth.json` 当作凭据持久化而报错，保留 [原始尝试](logs/r6/r6-closure-pi-inference.json)。确认文件内容是 `{}` 后，校验改为凭据存储必须为空；对同一已封存 artifact 离线复核，未新增模型请求：[verified 证据](logs/r6/r6-closure-pi-inference-verified.json)。该证据是一次无工具 smoke，不代表多轮编码任务或所有 provider 都已验收；覆盖率仅对应集成包装代码。

实现参考固定版本的 [Pi SDK 文档](https://raw.githubusercontent.com/earendil-works/pi/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/docs/sdk.md)、[DeepSeek 官方 Pi 接入说明](https://github.com/deepseek-ai/awesome-deepseek-agent/blob/main/docs/pi_mono.md)及 [当前模型说明](https://api-docs.deepseek.com/quick_start/pricing/)。凭据只经进程环境和 Pi 内存覆盖传入，不写入源码、配置、日志或报告。

**剩余未验证：macOS Node 24/22、原生 Ubuntu 主机 Node 24/22。** 本机仍只有 Windows 与 Docker Desktop，没有相应 runner；未发布或触发远端工作流。因此不宣布 R6 全阶段完成。用户已决定将这些组合延后至开源 CI，它们不阻塞 R7 初步维护和 R8 规划。最新汇总：[R6 当前状态](logs/r6/r6-closure-status.json)。下文为保留的历史执行记录，旧的 Pi blocked 与源码哈希不覆盖本节结论。

## 范围与基线

基线 `c0cceda9aa775e4960757c68687760da4a52b487`，保留当前未提交 R3–R5。新增 `integrations/fixtures/`、独立 `verify:r6`、六组合 GitHub Actions 配置、平台证据及指南；修复 CLI Windows 长路径 cwd 和管道错误处理。没有提交、推送或执行远端工作流。

## 已执行

- Windows 11 10.0.26200：Node 24.18.0 与 Node 22.23.2，两组均通过 10 项本地检查，Pi 项 blocked。包括当前用户 ACL 写拒绝与恢复。
- Ubuntu 22.04.5 Docker 非 root 用户：Node 24.15.0 与 Node 22.23.2，两组均通过 10 项本地检查，Pi 项 blocked。包括 POSIX 写权限拒绝与恢复。
- 四组均实际运行 deterministic/tool-calling/MCP stdio/HTTP Agent，核对精确输出、CI schema/退出码和 artifact 完整性。覆盖空格/非默认目录、长路径、并发与不可写 artifact 根；HTTP 没有被伪报有覆盖率。
- 结构化结果：[Windows 24](logs/r6/r6-win32-node24.json)、[Windows 22](logs/r6/r6-win32-node22.json)、[Ubuntu 容器 24](logs/r6/r6-linux-node24.json)、[Ubuntu 容器 22](logs/r6/r6-linux-node22.json)。运行日志见相邻 `r6-*.txt`。

本机命令：`pnpm build`、`pnpm check`、`pnpm verify:r6`；Node 22 使用临时 npm exec 固定 `node@22.23.2`，未替换全局 Node。Ubuntu 基于已存在的 `mcr.microsoft.com/playwright:v1.60.0-jammy`，独立容器复制源文件后冻结 lockfile 安装和构建，以非 root 执行脚本。源工作区只读挂载。容器和临时证据保留供审计，没有停止其他项目的服务。

构建通过，见 [构建日志](logs/r6/r6-build.txt)。完整回归重跑的 typecheck、340 项测试和 lint 通过，见 [检查日志](logs/r6/r6-check.txt)；当次 format 检查仅发现新生成的四份 JSON 格式差异，格式化后单独复核通过，见 [最终格式检查](logs/r6/r6-format.txt)。超时测试的 [16 项复核](logs/r6/r6-retest.txt)通过。

四组绑定相同源码树哈希 `ede4843ee22f44d388885607faef087f23b2563ce9b78a7903f99400c39ab7dc`，共 40 项 verified 检查。Linux 两组已实际验证 CI artifact 导出，完整导出副本位于 `.canary/runs/r6-evidence/linux-node24` 与 `linux-node22`；Windows 原始 artifact 位置见 JSON。临时容器均已停止，保留本轮自建 `canary-r6-*` 容器和 `canary-r6-local:validation` 镜像供审计。

## 过程发现

初次长路径执行暴露 Windows spawn ENOENT/管道 ENOTCONN，修复为扩展 cwd 路径并处理 stdout/stderr 错误，后续长路径真实执行通过。根目录断言纠正了 artifact 层数与 Windows 短路径规范化差异。Linux 首次缺少 pnpm shim，启用容器内 corepack 后构建通过；非 root 输出使用独立目录以避开历史 root 文件。首次完整检查中两项既有测试超过 5 秒，原始失败保留在 [初次日志](logs/r6/r6-check-initial.txt)，单独复核 16 项通过，没有放宽断言或测试超时。

## 未覆盖与下一步

- macOS Node 24/22：当前无 macOS runner；工作流尚未推送/运行，保持 blocked。
- 原生 Ubuntu 主机：当前只有 Docker 证据，不标原生主机 verified。
- Pi（历史状态，已被本文开头的闭环证据取代）：上游固定至 v0.86.0/commit `ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc`；当次只补齐真实运行时，尚未获得 provider/model 授权。后续已完成一次受限真实推理和离线复核。

该历史节点当时未进入 R7；当前决策与状态以本文开头的“问题闭环后的当前验收”为准。

## 2026-09-20 入口收尾后的补验

R4/R5 默认入口修改后，重新运行 Windows 24/22 与 Ubuntu 22.04 Docker 非 root 24/22，四组各 10 项 verified，共 40 项；源码树哈希一致为 `f879c5b182b101d0514bbccbe90df43eac675f0c9d998bc1068532591ee8c23d`。新证据不覆盖历史文件：[Windows 24](logs/r6/r6-followup-win32-node24.json)、[Windows 22](logs/r6/r6-followup-win32-node22.json)、[Ubuntu 容器 24](logs/r6/r6-followup-linux-node24.json)、[Ubuntu 容器 22](logs/r6/r6-followup-linux-node22.json)。相邻 txt 为原始日志。容器已停止，导出的原始 artifact 保存在 `.canary/runs/r6-followup-evidence/`。

复核 Pi 固定 commit 的官方 package.json 与 npm registry，发现原声明 `@mariozechner/pi-coding-agent@0.86.0` 返回 404，实际包为 `@earendil-works/pi-coding-agent@0.86.0`。已纠正 fixture 并固定 npm SHA-512 integrity，新增 `scripts/verify-r6-pi.mjs`。Windows Node 24 下，独立临时目录安装（禁用 lifecycle scripts），核对包版本、integrity、入口和 lockfile 哈希，通过 Canary 执行真实 `--version` 与 `--help`，输出断言及 artifact manifest 校验通过：[Pi 运行时证据](logs/r6/r6-pi-runtime.json)。模型调用数为 0，推理仍 blocked；不将 CLI 探测宣称为 Agent 模型验收。

当前环境探测仅发现 Windows 主机和 Docker Desktop WSL 发行版；未获得 macOS/原生 Ubuntu runner。`gh run list --workflow r6.yml` 对默认分支返回 404，本地工作流未发布，因此没有远端执行证据。本轮未提交、推送或触发远端工作流。每项缺口与解除条件见 [明确状态清单](logs/r6/r6-followup-status.json)。

本轮仍沿 R6 主线补实际运行及缺口证据，不启动 R7/R8。修正 `localGate` 聚合：本地必需项 blocked 时保持 blocked，不能将 root 跳过权限检查误标为本地门禁通过。

### 本仓库真实页面补验

在 4318 启动真实全局项目运行时，暴露历史 API 将大量 Agent 轨迹一并序列化的问题，导致请求阻塞及重复写响应头崩溃：[保留的失败日志](logs/r6/r6-page-initial-failure.txt)。项目页面现仅恢复和轮询项目检查历史；Agent 页面原接口保留。JSON 在写响应头前完成序列化，已发送响应不再重复写错误头。新增混合历史回归，Web 17 项测试通过；CLI 首次并发回归有一项 5 秒超时，保留日志并单独复核，不放宽超时。

页面修复后的最终平台证据再次完整运行：四组各 10 项 verified，共享源码树哈希 `17f0928a26a0905dda0fab64a5be4e63c534b99bdec1ea79e9d29abda5e2fd53`：[Windows 24](logs/r6/r6-final-win32-node24.json)、[Windows 22](logs/r6/r6-final-win32-node22.json)、[Ubuntu 容器 24](logs/r6/r6-final-linux-node24.json)、[Ubuntu 容器 22](logs/r6/r6-final-linux-node22.json)。前一次补验仍保留，不用历史通过覆盖当前源码结论。

完整隔离日志进一步定位到 R5 会话测试在全套并发下反复达到 5 秒超时；独立的 5 项 R5 会话测试通过。CLI 测试配置现限制为最多两个文件 worker，控制真实子进程并发；没有放宽超时或移除断言。此测试配置变更后的平台结果见 `r6-current-*.json`，当前源码状态以 `r6-followup-status.json` 的绑定为准。

最终四组仍各 10 项通过，源码树哈希为 `6507e270f76af0e89faecbce1442bf68abef5d865c031371a4595effd249d8c9`。真实全局页面 `canary run --port 4318 --no-open` 的原运行 `run_71b5481d-cdfe-40eb-be40-059dca6ba7d7` 保留格式与测试失败；修正证据 JSON 格式、限制测试并发后，通过页面重试得到 `run_77303c32-8d72-45f6-8997-37e9eb439353`，build、format:check、全仓 test 全部 passed。原运行其余 typecheck、lint、Agent 回归均已 passed。本次不是伪造一个六项全绿的新运行，而是保留真实失败和重试谱系。

页面及项目历史 API 均返回 200，最终 API 的检查状态和耗时与持久化 run.json 一致，重试 manifest verified：[真实页面证据](logs/r6/r6-live-page.json)。验收后保留回环 4318 服务供当前用户查看；端口存活只代表本次会话。详细输出仍受已有 64 KiB 上限约束。[Web 17 项测试](logs/r6/r6-page-web-tests.txt)、[R5 5 项独立复核](logs/r6/r6-page-focused-tests.txt)、[原隔离并发失败日志](logs/r6/r6-page-isolated-initial.txt)均保留。

命令边界：全局安装使 CLI 在任意目录可调用，但执行范围是当前目录向上找到的项目配置。本仓库默认六项检查，其他项目需声明自己的检查；不自动扫描全机所有仓库，不自动触发 GitHub CI。页面状态、耗时、日志和证据来自真实进程；四个离线 Agent fixture 是固定回归样本。本段记录形成时 Pi 模型输出尚无真实证据，现已由本文开头的一次受限真实推理证据取代。

## 主线与回退

保持本地优先；无自动外发轨迹、源码修复或自动循环。2026-09-21 唯一模型请求由用户明确授权，只发送固定 smoke prompt；其余网络用于依赖获取，HTTP fixture 只访问回环。临时 ACL/chmod 限于自建 fixture 且有恢复。安装目录和被测临时项目分离。容器证据、blocked 与 verified 没有混用。

回退可移除 R6 独立脚本/fixture/workflow/文档，并撤回 check-executor 的扩展 cwd 与管道错误处理；保留原有 R3–R5 和全部历史 artifact。使用见 [R6 指南](../guides/r6-platform-fixtures.md)。
