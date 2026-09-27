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

![Canary 工作台早期页面截图；当前界面以运行后的本地页面为准](docs/images/ui-overview.png)

---

> 当前执行状态见[阶段总表](docs/roadmap/README.md)及[支持与证据矩阵](docs/guides/support-matrix.md)。R0–R5 已在指定 Windows Node 24 范围验收；R6 有 Windows、Ubuntu 容器、固定 Pi 运行时和一次受限真实推理证据，macOS 与原生 Ubuntu 延后；R7 完成初步维护；R8 的本机受控经验闭环已验收。R9 已验证可复现交付、三个外部项目接入，以及确定性比较和失败诊断流程；真实故障数据集与模型评分人工校准仍待补齐，见[交付记录](docs/evidence/r9-00-01-execution.md)和[比较与诊断记录](docs/evidence/r9-03-04-execution.md)。

## 🎯 为什么用 Canary？

> 后续产品路线已扩展到普通软件项目的 **CI 变更验证与修复**：故障证据 → PR 接入 → 复现 → 修复验证 → 变更验证缺口。见 [R16–R21 任务计划](docs/roadmap/13-r16-r21-change-verification.md)。这些新增任务尚待实施；下文仍描述现有 Agent 使用场景。

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
| 🖼️  | **统一验证工作台** — 项目检查、Agent 用例、覆盖率、轨迹、证据、比较和改进建议按运行类型展示         |

---

## 🚀 快速开始

默认示例不需要模型 API Key；真实 HTTP 服务或模型由被测项目自行启动和配置。

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
canary run --ci                  # 执行当前项目的显式检查计划
canary run --port 4318           # 运行并展示本地端口页面
canary run --port 4318 --no-open # 保留页面服务，手动打开 URL
canary report <runId>            # 导出该项目运行的 markdown 报告
canary structure --base HEAD      # 查看当前结构与 Git 基线差异
```

目标项目需配置 `canary.project.json` 或 `canary.config.ts`。同目录优先项目 JSON；缺配置会报错，不执行安装目录 Demo。仓库默认计划包含 build、typecheck、lint、格式检查、全仓测试与 Agent 回归。Agent demo 可使用 `pnpm demo`，Agent replay/compare 使用显式 Agent 配置。详见 [默认入口与全局验收](docs/evidence/entry-execution-record.md)。

运行产物写在被测项目的 `.canary/artifacts/<runId>/`。项目检查保存检查证据和报告；Agent 子运行另有轨迹。只有已采集的覆盖率才显示数值，HTTP 黑盒和独立 MCP 服务的源码覆盖率会标为不可用。

运行时会保存项目结构快照。使用 `canary run --ci --base HEAD` 可同时记录相对 Git 基线的文件变更；`canary structure --run <runId>` 读取经 manifest 校验的历史结构。页面“项目结构”和只读 MCP `canary.structure` 共用该快照。分层配置与语言边界见 [R10 使用指南](docs/guides/project-structure.md)。
页面首页的“探索项目地图”可进入二维层级图或三维分层视图，从项目逐级定位到 JS/TS 文件、类与函数。操作、搜索、上下游过滤和历史源码保护见 [R11 架构地图指南](docs/guides/architecture-map.md)。
覆盖率指标可以定位到地图中的文件与函数；未覆盖分支可跳转到源码，失败堆栈单独标记为错误证据。未采集或源码无法核对时显示未知，使用方法与边界见 [R12 地图诊断](docs/roadmap/11-r12-map-diagnostics.md)。

架构地图还提供循环依赖、显式分层违规和变更消费者的解释。`canary impact --base HEAD` 预览检查选择；`canary run --ci --affected --base HEAD` 根据项目声明的输入范围执行增量检查，未知情况保守全量，省略不计通过。配置与边界见[架构诊断及增量 CI](docs/guides/architecture-ci.md)。

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
├── apps/web/           # 统一验证工作台与控制面页面
├── cases/              # smoke / regression / holdout
├── examples/           # 6 个可直接跑的 demo agent
└── .github/workflows/  # CI · Release
```

---

## 🔌 适配器 & 覆盖率支持矩阵

| Target        | Adapter                  | Coverage                                                 |
| ------------- | ------------------------ | -------------------------------------------------------- |
| 本地 TS Agent | `function`               | V8 行/分支/函数/语句，限配置范围                         |
| HTTP Agent    | `http`                   | `unavailable`（黑盒）；`requestField` 可指定顶层请求字段 |
| MCP Agent     | `mcp` stdio              | `unavailable`（独立进程）；当前固定调用 `run` 工具       |
| MCP Tools     | `mcp-stdio` / `mcp-http` | 工具层；HTTP 尚非完整 Streamable HTTP session            |
| Bun           | CLI smoke 仅             | 未宣称覆盖率支持                                         |

---

## 🗺️ 路线图

- **R9 外部项目试点** — [三个公开项目接入配置](integrations/r9-external/README.md)与可复现交付
- **评估可信度** — 真实故障集、修复前后配对比较与不确定性呈现，见[下一阶段评估](docs/strategy/2026-09-25-next-stage-assessment.md)
- **平台补验** — macOS、原生 Ubuntu 与持续运行证据，按实际开源和使用范围安排

> 默认本地检查不会自动调用模型；显式配置的远端 Agent、Judge 或宿主可发起网络请求。Canary 不提供 OS 级沙箱，外部项目需在可信环境中执行。

---

## ❤️ 贡献

欢迎 Issue 和 PR。大改动请先开 Issue 讨论。

```bash
git clone https://github.com/EVEDensity/Canary
cd Canary
pnpm install
pnpm build          # 编译所有 packages
pnpm check          # format + lint + typecheck + test
pnpm demo:headless  # 显式运行 Agent demo，独立于项目完整门禁
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
