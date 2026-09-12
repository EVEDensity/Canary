<div align="center">
  <img src="docs/images/logo-hero.png" height="200" align="middle" />
</div>

<div align="center">

<div>
<a href="https://github.com/EVEDensity/Canary/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/EVEDensity/Canary/ci.yml?label=ci&style=flat-square" alt="CI" /></a>
<a href="https://github.com/EVEDensity/Canary/releases/latest"><img src="https://img.shields.io/github/v/release/EVEDensity/Canary?color=76bad9&style=flat-square" alt="Release" /></a>
<img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="License: Apache-2.0" />
<img src="https://img.shields.io/badge/pnpm-10-orange?logo=pnpm&style=flat-square" alt="pnpm" />
<img src="https://img.shields.io/badge/node-%E2%89%A522-green?logo=node.js&style=flat-square" alt="Node ≥22" />
<a href="https://github.com/EVEDensity/Canary/stargazers"><img src="https://img.shields.io/github/stars/EVEDensity/Canary?style=flat-square" alt="Stars" /></a>
</div>

<br>

<a href="docs/getting-started.md">Getting Started</a> ｜
<a href="docs/architecture.md">Architecture</a> ｜
<a href="docs/feature-coverage.md">Feature Coverage</a> ｜
<a href="docs/self-improvement.md">Self-Improvement</a> ｜
<a href="docs/ci.md">CI</a> ｜
<a href="docs/troubleshooting.md">Troubleshooting</a> ｜
<a href="./SECURITY.md">Security</a> ｜
<a href="https://github.com/EVEDensity/Canary/issues">Issues</a>

</div>

**canary** is a local-first TypeScript Agent testing, coverage, and improvement workspace. It runs your Agent like an end-to-end test — records trajectory, collects V8 source coverage, and turns failures into auditable regression work. It does **not** edit Agent source.

Agent runs locally and you think it works? Not quite. `canary` treats your Agent as repeatable test cases: run each case, capture the full trajectory (system prompt, user input, tool call chain, final answer), and collect live V8 source coverage (lines / branches / functions / statements). Coverage is never faked — missing instrumentation is honestly marked `unavailable`, never 0% or 100%. Failures are auto-attributed (prompt error / tool unavailable / policy violation / infinite loop), generating an auditable regression checklist; on the next run, baseline vs candidate comparison produces a report or junit for CI gating.

![Local UI five-view screenshot](docs/images/ui-overview.png)

## ✨ Key Features

1. 🎯 **V8 Source Coverage** — Live continuous sampling during execution, merged at final; honestly reports `unavailable` when instrumentation is absent.
2. 🪝 **Multi-Adapter** — `function` (local), `http` (black-box), `mcp` (stdio), `mcp-http`.
3. 🔁 **Repetitions** — `--repetitions N` runs the same case N times, summarizing variance and stability.
4. 🛠️ **Mock Environment** — In-memory StateStore with snapshot/restore + MockToolAdapter; no external services required.
5. 🧪 **Extensible Evaluators** — Built-in assertion / state / tool / policy / loop / coverage / coverage-gate evaluators; pluggable LLM-as-Judge.
6. 🏷️ **Replay & Compare** — Any runId can be replayed or diffed; CLI outputs markdown / junit / console reports.
7. 🧠 **Improvement Loop** — Failures auto-attributed → generates regression cases → compare baseline/candidate → admission.
8. 🖼️ **Five-View Web UI** — Live run / Case Detail (assertion diff + source highlight + state diff + preparing state) / Coverage / Compare / Replay.

## 🚀 Quick Start

> **One-line install → global `canary run` from anywhere.** No `npm i -g` or `npx` required.

Requires Node ≥22 and Git.

**Windows (PowerShell):**

```powershell
git clone https://github.com/EVEDensity/Canary.git "$env:USERPROFILE\Canary"; node "$env:USERPROFILE\Canary\scripts\install-global.mjs"
```

**macOS / Linux:**

```bash
git clone https://github.com/EVEDensity/Canary.git "$HOME/Canary" && node "$HOME/Canary/scripts/install-global.mjs"
```

Open a **new terminal**, then:

```bash
canary run
```

Runs the default 15-case demo and opens the local UI. Headless: `canary run --headless --no-open`.

Already inside the repo? `node scripts/install-global.mjs` or `pnpm install:global`.

Default suite: 15 deterministic cases under `cases/` against `examples/local-agent` — no API keys needed. Artifacts land at `.canary/artifacts/<runId>/`.

### Common Commands

```bash
canary run                             # Global command after install:global
canary run --headless --no-open
canary report <runId> --format markdown
canary compare <baselineId> <candidateId>
canary replay <runId> --headless --no-open
canary run --repetitions 3 --tag nightly
```

## 📦 Monorepo Structure

```
Canary/
├── packages/
│   ├── core/           # Domain types + Zod schema + IPC protocol
│   ├── coverage/       # V8 collector + Istanbul fallback + fragments merge
│   ├── evaluators/     # Evaluator suite + attribution engine + LLM Judge
│   ├── adapters/       # function / http / mcp / mcp-http adapters
│   ├── environment/    # In-memory StateStore + MockTool
│   ├── runner/         # Orchestration · repetitions · cancel · streaming artifacts
│   ├── reporters/      # json · markdown · junit · console
│   ├── improvement/    # Compare · decideSuggestion · regression drafts
│   ├── trace/          # JSONL persistence store
│   └── cli/            # run / shows / report / compare / improve / replay / verify
├── apps/web/           # Five-view Web UI (SSE)
├── cases/              # smoke / regression / holdout
├── examples/           # local-agent · mcp-agent · http-agent · loop-agent · recovery-agent · improvement-demo
├── docs/               # Architecture · Getting Started · MCP · CI · Replay · Self-improvement · ...
└── .github/workflows/  # CI · Release
```

## 📋 Adapter & Coverage Matrix

| Target         | Adapter                  | Coverage                                     |
| -------------- | ------------------------ | -------------------------------------------- |
| Local TS Agent | `function`               | V8 lines / branches / functions / statements |
| HTTP Agent     | `http`                   | `unavailable`                                |
| MCP Agent      | `mcp` stdio              | `unavailable`                                |
| MCP Tools      | `mcp-stdio` / `mcp-http` | N/A (tools)                                  |
| Bun            | CLI smoke only           | not claimed                                  |

## ⚠️ Honest Boundaries

`canary` does **not** measure remote black-box reasoning quality, non-Node languages, browser visual agents, or Docker sandboxes. Judge scores are optional and **fail closed** on error, timeout, or low confidence.

The runner is **not** a sandbox — it executes your Agent code directly. By default no model API is called outbound.

## ❤️ Contributing

Issues and Pull Requests are always welcome. For adding new features, please discuss via an Issue first.

```bash
git clone https://github.com/EVEDensity/Canary
pnpm install
pnpm check          # format / lint / typecheck / test
pnpm demo:headless  # default 15-case smoke (same as CI)
```

## 🌍 Community & Links

<a href="https://github.com/EVEDensity/Canary/discussions">Discussions</a> ｜
<a href="https://github.com/EVEDensity/Canary/issues">Issue Tracker</a> ｜
<a href="docs/acceptance-10-min.md">10-minute Acceptance</a>

## 📄 License

[Apache-2.0](./LICENSE)

—— Like a canary in a coal mine: early signal, precise localization, auditable trail.
