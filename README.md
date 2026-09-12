<p align="center">
  <img src="docs/images/logo.png" height="120" alt="Canary" />
</p>

<p align="center">
  <strong>canary</strong> — 本地 Agent 的端到端测试、运行时覆盖率与回归改进工作台
</p>

<p align="center">
  <a href="https://github.com/EVEDensity/Canary/actions"><img src="https://img.shields.io/github/actions/workflow/status/EVEDensity/Canary/ci.yml?label=ci" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" /></a>
  <img src="https://img.shields.io/badge/pnpm-10-orange?logo=pnpm" />
  <img src="https://img.shields.io/badge/node-%E2%89%A522-green?logo=node.js" />
  <a href="https://github.com/EVEDensity/Canary/stargazers"><img src="https://img.shields.io/github/stars/EVEDensity/Canary" /></a>
</p>

<p align="center">
  <img src="docs/images/ui-overview.png" alt="Local UI five-view screenshot" width="720" />
</p>

---

## 这是什么

Agent 在本地跑起来就以为完事了？**不是。**

`canary` 把你的 TypeScript Agent 当成可重复执行的端到端测试：跑完每个 case，记录完整 trajectory（系统提示、用户输入、工具调用链、最终回答），同时采集 V8 源码覆盖率（行 / 分支 / 函数 / 语句）。覆盖率不会伪造 — 没有 instrument 就如实标 `unavailable`，不会充 0% 也不会充 100%。

失败时自动归因（prompt 错误 / 工具不可用 / 策略违规 / 死循环），生成可审计的 regression 清单；下一轮 compare baseline vs candidate，跑出改进报告或 junit 供 CI 门禁。

## 核心能力

| 能力 | 说明 |
|------|------|
| 🎯 **V8 源码覆盖率** | 运行中持续采样，final 合并；缺 instrument 时诚实标 `unavailable` |
| 🪝 **多 Adapter** | `function`（本地函数）/ `http`（黑盒）/ `mcp`（stdio）/ `mcp-http` |
| 🔁 **Repetitions** | `--repetitions N` 同一 case 跑 N 次，汇总波动与稳定性 |
| 🛠️ **Mock Environment** | 内存 StateStore + snapshot/restore + MockToolAdapter，无需外部服务 |
| 🧪 **可扩展 Evaluator** | 内置 assertion / state / tool / policy / loop / coverage / judge；可插 LLM-as-Judge |
| 🏷️ **Replay & Compare** | 任何 runId 可重放 / 对比；CLI 一键 generate markdown / junit / console 报告 |
| 🧠 **Improvement 闭环** | 失败自动归因 → 生成 regression cases → compare baseline/candidate → 准入 |
| 🖼️ **五视图 Web UI** | 运行态 / Case Detail（含断言 diff + source highlight + state diff + preparing）/ Coverage / Compare / Replay |

## Quick Start

```bash
# 一次性
pnpm install && pnpm canary -- run
```

默认跑 `cases/` 下 15 个确定性 case（无 API key，against `examples/local-agent`）。产物落在 `.canary/artifacts/<runId>/`。

```bash
# 常用操作
pnpm canary -- show <runId>                         # 打开 Web UI
pnpm canary -- report <runId> --format markdown      # 输出 markdown 报告
pnpm canary -- compare <baselineId> <candidateId>    # 对比两次运行
pnpm canary -- replay <runId> --headless --no-open   # 无界面重放（CI）

# CI 友好
pnpm canary -- run --headless --no-open --repetitions 3 --tag nightly
```

## 支持范围

| Target         | Adapter                    | Coverage                                     |
| -------------- | -------------------------- | -------------------------------------------- |
| Local TS Agent | `function`                 | V8 lines / branches / functions / statements |
| HTTP Agent     | `http`                     | `unavailable`                                |
| MCP Agent      | `mcp` stdio                | `unavailable`                                |
| MCP Tools      | `mcp-stdio` / `mcp-http`   | N/A (tools)                                  |
| Bun            | CLI smoke only             | not claimed                                  |

## 诚实边界

`canary` **不测量**远端黑盒推理质量、非 Node 语言、浏览器视觉 Agent、Docker 沙箱。Judge 评分是可选的，错误 / 超时 / 低置信度时直接 fail closed。

Runner **不是** sandbox — 运行的就是你的 Agent 代码。默认不外发任何模型调用。

## 文档

| | |
|---|---|
| [Getting Started](docs/getting-started.md) | [Agent Adapter](docs/agent-adapter.md) |
| [MCP Integration](docs/mcp.md) | [Mock Environment](docs/mock-environment.md) |
| [Feature Coverage](docs/feature-coverage.md) | [Local UI](docs/local-ui.md) |
| [CI Setup](docs/ci.md) | [Replay & Compare](docs/replay.md) |
| [Self-improvement](docs/self-improvement.md) | [Troubleshooting](docs/troubleshooting.md) |
| [Architecture](docs/architecture.md) | [10-minute Acceptance](docs/acceptance-10-min.md) |

## License

[Apache-2.0](./LICENSE) · 本地优先 · 无默认外连模型

—— 像 canary in a coal mine，早发现、快定位、可审计。
