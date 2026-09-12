# Getting Started

Install Node.js 22+ and pnpm 10.

```powershell
pnpm install
pnpm canary -- run
```

`canary run` executes `canary.config.ts`, writes `.canary/artifacts/<runId>/`, and opens the local UI. CI and scripts should use `--headless --no-open`.

The default suite lives in `cases/smoke/`, `cases/regression/`, and `cases/holdout/`, targeting `examples/local-agent`.

Next: [Agent Adapter](./agent-adapter.md), [Feature Coverage](./feature-coverage.md), [Local UI](./local-ui.md). Formal checklist: [10-minute acceptance](./acceptance-10-min.md).
