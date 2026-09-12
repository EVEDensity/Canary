# Getting Started

canary is meant to run **from this repository** on your machine. You do **not** need `npm i -g @canary/cli` or `npx canary run` for day-to-day work.

## Prerequisites

- Node.js **22+** (24 LTS recommended)
- [pnpm](https://pnpm.io/) **10** — enable once with Corepack:

```powershell
corepack enable
corepack prepare pnpm@10.15.0 --activate
```

## Personal developer workflow (recommended)

```powershell
git clone https://github.com/EVEDensity/Canary.git
cd Canary
pnpm install
pnpm demo
```

`pnpm demo` runs the default 15-case suite, writes artifacts to `.canary/artifacts/<runId>/`, and opens the local UI in your browser.

Headless check (same path CI uses):

```powershell
pnpm demo:headless
```

Other commands still go through the workspace CLI when you need flags:

```powershell
pnpm canary -- report <runId> --format markdown
pnpm canary -- compare <baselineRunId> <candidateRunId>
pnpm canary -- replay <runId> --headless --no-open
pnpm canary -- run --headless --no-open --config examples/mcp-agent/canary.config.ts
```

## What gets exercised

The root `canary.config.ts` targets `examples/local-agent` with cases under `cases/smoke/`, `cases/regression/`, and `cases/holdout/`. No API keys or external models are required.

## Next steps

- [Agent Adapter](./agent-adapter.md)
- [Feature Coverage](./feature-coverage.md)
- [Local UI](./local-ui.md)
- [10-minute acceptance](./acceptance-10-min.md)
