# R6 平台与 Agent 验收

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm verify:r6
```

Node 24 为主验证，Node 22 为兼容组合。每次运行记录实际 Node/OS、执行环境、基线 commit、关键变更文件哈希、fixture 哈希、运行 ID、manifest 哈希和逐项状态。当前脚本只测试显式列出的边界，不代表整个操作系统或完整生态认证。

默认结果位于 `.canary/logs/verification/r6/<时间-随机ID>/r6-<platform>-node<major>.json`；可通过 `CANARY_R6_OUTPUT` 显式导出文件，`CANARY_R6_CONTEXT` 标明容器或原生环境。`CANARY_R6_EXPORT=1` 会把已产生的运行目录复制到输出文件旁的 `artifacts/`，供 CI 上传。`pnpm verify:r6` 还将有界脱敏日志和运行状态写入本次目录；默认不再污染历史文档归档。

按 2026-09-21 用户决定，macOS 和原生 Ubuntu 留到开源后的 CI；当前本机工作不等待这两项。六组合配置保留，未执行的平台仍不标 verified。

验收包含四种可离线运行的 Agent、路径带空格和非默认目录、超过 260 字符的项目路径、同项目并发、不可写 artifact 路径、真实 ACL/POSIX 权限拒绝及 fixture 内容未变化。见 [fixture 说明](../../integrations/fixtures/README.md)。命令检查仅在 Windows cwd 长度达到 260 时使用扩展路径，短路径保留普通形式；这不承诺任意第三方程序都支持长路径。

`.github/workflows/r6.yml` 配置 Windows、Ubuntu、macOS × Node 24/22 六组合，失败时仍上传已生成证据。不需要模型凭证，默认不运行外部 Pi 推理。工作流存在不代表已经执行；`localGate: passed` 表示已执行必需本地检查通过，`stageComplete: false` 明确不替代跨平台/Pi 阶段总验收。

Ubuntu Docker 结果证明 Linux 用户空间和容器内系统边界，不能替代原生 Ubuntu 主机验证；更不能替代 macOS。实际状态见 [R6 执行记录](../evidence/r6-execution-record.md)。

Pi 的独立运行时验收：`node scripts/verify-r6-pi.mjs --install`。它隔离安装上游固定包并执行真实版本/帮助命令，生成 Canary artifact；不调用模型。运行时 `runtimeGate: passed` 与推理 `blocked` 分开记录，详见 [Pi fixture](../../integrations/fixtures/pi-agent/README.md)。模型验收需要另行明确 provider、model、凭证注入或本地服务及预算；不得用 mock 或版本输出替代。

`localGate` 遇到本地必需检查 blocked 时也返回 blocked；只有外部 Pi 未配置且本地检查全部通过时才为 passed。`stageComplete` 不会因为单平台通过而成为 true。跨平台缺口见 [最新状态清单](../evidence/logs/r6/r6-closure-status.json)。

## 按需真实 Pi 推理

先生成上述运行时报告，再通过当前进程环境注入 `DEEPSEEK_API_KEY`，显式执行：

```sh
node scripts/verify-r6-pi-inference.mjs --allow-inference --runtime-report docs/evidence/logs/r6/r6-closure-pi-runtime.json --model deepseek-flash --output docs/evidence/logs/pi-inference-new.json
```

不要把密钥放进 CLI 参数、配置文件或版本库。脚本使用独立临时项目、内存会话和凭据覆盖；只允许一次 DeepSeek 请求，最多 128 个输出 token，禁用工具、重试、Skill、扩展和项目上下文。使用官方 Pi SDK 真正执行提示词，由 Canary 校验精确输出及推理事件，封存结果和真实用量。适配包装代码的覆盖率不代表 Pi 或模型内部覆盖率。

已有执行结果可离线复核，不消耗模型调用：

```sh
node scripts/verify-r6-pi-inference.mjs --verify-existing docs/evidence/logs/pi-inference-new.json --output docs/evidence/logs/pi-inference-revalidated.json
```

2026-09-21 的一次 DeepSeek smoke 已 verified（75 token），见 [推理证据](../evidence/logs/r6/r6-closure-pi-inference-verified.json)。默认 `verify:r6` 仍不调用模型；其 Pi blocked 记录表示默认离线验收未执行该项，应结合单独推理证据判断，而不是将密钥写进默认配置。
