<div align="center">
  <img src="docs/images/logo-hero.png" height="200" align="middle" />

  <p><strong>像跑单元测试一样测试你的 AI Agent。</strong><br>
  本地执行 · V8 源码覆盖率 · 可回放 · 可对比 · 可导出</p>

  <div>
    <a href="https://github.com/EVEDensity/Canary/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/EVEDensity/Canary/ci.yml?label=ci&style=flat-square" alt="CI" /></a>
    <a href="https://github.com/EVEDensity/Canary/releases/latest"><img src="https://img.shields.io/github/v/release/EVEDensity/Canary?color=76bad9&style=flat-square" alt="Release" /></a>
    <img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="License: Apache-2.0" />
    <img src="https://img.shields.io/badge/pnpm-10-orange?logo=pnpm&style=flat-square" alt="pnpm" />
    <img src="https://img.shields.io/badge/node-%E2%89%A522-green?logo=node.js&style=flat-square" alt="Node ≥22" />
    <a href="https://github.com/EVEDensity/Canary/stargazers"><img src="https://img.shields.io/github/stars/EVEDensity/Canary?style=flat-square" alt="Stars" /></a>
  </div>

  <p>
    <a href="docs/guides/getting-started.md">🚀 快速开始</a> ｜
    <a href="docs/current/architecture.md">架构</a> ｜
    <a href="docs/guides/evaluation-and-coverage.md">特性矩阵</a> ｜
    <a href="docs/guides/improvement.md">回归分析</a> ｜
    <a href="docs/guides/ci-and-validation.md">CI 集成</a> ｜
    <a href="https://github.com/EVEDensity/Canary/issues">Issue</a>
  </p>
</div>

![Web UI five-view screenshot](docs/images/ui-overview.png)

---

> 当前执行基线：[个人开发者路线图 R0–R8](docs/roadmap/06-personal-production-test-roadmap.md)。R0 已冻结 [CLI/root/schema 契约](docs/guides/r0-cli-contract.md)，[真实验收](docs/evidence/r0-execution.md)限 Windows Node 24；项目仍在补齐生产级运行器和三平台证据。已配置项目可运行 `canary run --ci`，目前执行 Agent cases，不冒充全仓库自动 CI。

## 🎯 为什么用 Canary？

你在构建一个 AI Agent，但你敢回答这些问题吗：

- 你的 Agent **真的**执行了正确的工具链吗？
- 改了一行 prompt，之前通过的 case 会不会悄悄挂掉？
- 你能拿到 Agent 的 **源码覆盖率**，而不是只看返回值对不对？
- 你能把一次执行 **完整回放** 给同事看吗？

Canary 就是为回答这些问题而生的。它像 Jest 之于单元测试，只是测试对象换成了 Agent。

> Like a canary in a coal mine — early signal, precise localization, auditable trail.

---

## ✨ 核心特性

|     |                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------- |
| 🎯  | **V8 源码覆盖率** — 执行时实时采样，合并行/分支/函数/语句覆盖；适配不支持时诚实地标记 `unavailable` |
| 🔌  | **多适配器** — 本地函数、HTTP 黑盒、MCP stdio/HTTP，一套 CLI 覆盖                                   |
| 🔁  | **多次重复** — `--repetitions N` 自动跑 N 次，捕获非确定性波动                                      |
| 🛠️  | **Mock 环境** — 内存 StateStore + 快照/恢复 + MockToolAdapter，零外部依赖                           |
| 🧪  | **7 类 Evaluator** — 断言 / 状态 / 工具 / 策略 / 循环 / 覆盖率 / 覆盖率门禁                         |
| 🏷️  | **回放 & 对比** — 完整重跑历史 case，baseline vs candidate diff 一目了然                            |
| 🧠  | **回归归因** — 失败 → 归因 → 生成候选 → 对比报告，全链路可审计                                      |
| 🖼️  | **五视图 Web UI** — Live Run / Case Detail / Coverage / Compare / Replay，SSE 实时推送              |

---

## 🚀 快速开始

**1 分钟装完，0 API Key，自带 15 个可跑的 demo case。**

> ⚠️ 需要 Node ≥ 22 和 Git。

**Windows (PowerShell):**

```powershell
iwr -useb https://raw.githubusercontent.com/EVEDensity/Canary/main/install.ps1 | iex
```

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/EVEDensity/Canary/main/install.sh | bash
```

新开一个终端，然后：

```bash
canary run                       # 跑默认 15 个 case
canary run --headless --no-open  # 无头模式（CI 友好）
canary report <runId>            # 生成 markdown 报告
canary compare <base> <cand>     # 对比两次运行
canary replay <runId>            # 完整回放
```

就这么多。第一次跑会在 `.canary/artifacts/<runId>/` 生成完整的 trajectory + 覆盖率 + 报告。

---

## 🧑‍💻 适用场景

| 场景                  | 怎么用                                                         |
| --------------------- | -------------------------------------------------------------- |
| **本地 Agent 开发**   | `function` 适配器直接 import 你的 TS 入口，拿真实 V8 覆盖率    |
| **远程 Agent / SaaS** | `http` 适配器 + 断言 evaluator，黑盒也能测回归                 |
| **MCP Server**        | 直接测 stdio/HTTP 的 MCP tools，验证工具行为稳定性             |
| **CI/CD 门禁**        | headless 模式 + coverage-gate evaluator，低于阈值直接 fail     |
| **实验对比**          | 同一 case 跑 baseline 和 candidate，`compare` 出 markdown diff |

内置 6 个 example agent 覆盖以上所有场景：`local-agent` · `mcp-agent` · `http-agent` · `loop-agent` · `recovery-agent` · `improvement-demo`。

---

## 📦 项目结构

```
Canary/
├── packages/
│   ├── core/           # 领域类型 + Zod Schema + IPC 协议
│   ├── coverage/       # V8 采集 + Istanbul 回退 + fragments 合并
│   ├── evaluators/     # Evaluator 套件 + 归因引擎 + LLM Judge 接口
│   ├── adapters/       # Agent 适配器: function / http / mcp
│   ├── environment/    # 内存 StateStore + MockTool
│   ├── runner/         # 编排 · repetitions · cancel · 流式 artifact
│   ├── reporters/      # json · markdown · junit · console
│   ├── improvement/    # Compare · 回归归因 · 候选建议
│   ├── trace/          # JSONL 持久化存储
│   └── cli/            # run / runs / show / report / compare / replay / improve
├── apps/web/           # 五视图 Web UI (SSE)
├── cases/              # smoke / regression / holdout
├── examples/           # 6 个可直接跑的 demo agent
└── .github/workflows/  # CI · Release
```

---

## 🔌 适配器 & 覆盖率支持矩阵

| Target        | Adapter                  | Coverage                     |
| ------------- | ------------------------ | ---------------------------- |
| 本地 TS Agent | `function`               | ✅ V8 行/分支/函数/语句      |
| HTTP Agent    | `http`                   | ❌ `unavailable`（黑盒）     |
| MCP Agent     | `mcp` stdio              | ❌ `unavailable`（进程隔离） |
| MCP Tools     | `mcp-stdio` / `mcp-http` | N/A（纯工具层）              |
| Bun           | CLI smoke 仅             | ❌ 未宣称支持                |

---

## 🗺️ 路线图

- **Soft Evolution** — 自动生成回归修复建议（当前：归因 → 手动 review）
- **Hard Evolution** — 受控的自动 code apply + verify + gate admission
- **更多语言** — Python / Go / Rust 的 V8-aligned 覆盖率采集器
- **浏览器 Agent** — Playwright adapter + 视觉断言

> 当前 Runner 不编辑 Agent 源码，不执行沙箱隔离，不调用外部 LLM API。

---

## ❤️ 贡献

欢迎 Issue 和 PR。大改动请先开 Issue 讨论。

```bash
git clone https://github.com/EVEDensity/Canary
cd Canary
pnpm install
pnpm build          # 编译所有 packages
pnpm check          # format + lint + typecheck + test
pnpm demo:headless  # 跑默认 15-case smoke（和 CI 一样）
```

---

## 🌍 社区

<a href="https://github.com/EVEDensity/Canary/discussions">💬 Discussions</a> ｜
<a href="https://github.com/EVEDensity/Canary/issues">🐛 Issue Tracker</a> ｜
<a href="docs/guides/ci-and-validation.md">✅ 10 分钟验收</a>

---

## 📄 License

[Apache-2.0](./LICENSE)

---

<div align="center">

如果这个项目对你有帮助，**点个 ⭐ 吧！** 你的 star 是我持续迭代的燃料 🧪

</div>
