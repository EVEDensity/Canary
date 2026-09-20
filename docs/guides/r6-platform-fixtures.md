# R6 平台与 Agent 验收

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm verify:r6
```

Node 24 为主验证，Node 22 为兼容组合。每次运行记录实际 Node/OS、执行环境、基线 commit、关键变更文件哈希、fixture 哈希、运行 ID、manifest 哈希和逐项状态。当前脚本只测试显式列出的边界，不代表整个操作系统或完整生态认证。

默认结果位于 `docs/evidence/logs/r6-<platform>-node<major>.json`；可通过 `CANARY_R6_OUTPUT` 指定独立文件，`CANARY_R6_CONTEXT` 标明容器或原生环境。`CANARY_R6_EXPORT=1` 会把已产生的运行目录复制到输出文件旁的 `artifacts/`，供 CI 上传。多次历史验收应使用独立输出名保存，避免覆盖。

验收包含四种可离线运行的 Agent、路径带空格和非默认目录、超过 260 字符的项目路径、同项目并发、不可写 artifact 路径、真实 ACL/POSIX 权限拒绝及 fixture 内容未变化。见 [fixture 说明](../../integrations/fixtures/README.md)。命令检查仅在 Windows cwd 长度达到 260 时使用扩展路径，短路径保留普通形式；这不承诺任意第三方程序都支持长路径。

`.github/workflows/r6.yml` 配置 Windows、Ubuntu、macOS × Node 24/22 六组合，失败时仍上传已生成证据。不需要模型凭证，默认不运行外部 Pi 推理。工作流存在不代表已经执行；`localGate: passed` 表示已执行必需本地检查通过，`stageComplete: false` 明确不替代跨平台/Pi 阶段总验收。

Ubuntu Docker 结果证明 Linux 用户空间和容器内系统边界，不能替代原生 Ubuntu 主机验证；更不能替代 macOS。实际状态见 [R6 执行记录](../evidence/r6-execution-record.md)。

Pi 的独立运行时验收：`node scripts/verify-r6-pi.mjs --install`。它隔离安装上游固定包并执行真实版本/帮助命令，生成 Canary artifact；不调用模型。运行时 `runtimeGate: passed` 与推理 `blocked` 分开记录，详见 [Pi fixture](../../integrations/fixtures/pi-agent/README.md)。模型验收需要另行明确 provider、model、凭证注入或本地服务及预算；不得用 mock 或版本输出替代。

`localGate` 遇到本地必需检查 blocked 时也返回 blocked；只有外部 Pi 未配置且本地检查全部通过时才为 passed。`stageComplete` 不会因为单平台通过而成为 true。跨平台缺口见 [本轮状态清单](../evidence/logs/r6-followup-status.json)。
