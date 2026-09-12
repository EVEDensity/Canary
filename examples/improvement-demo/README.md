# Improvement loop demo

Faulty Agent → attribution → human accept/verify → candidate rerun → compare.

```bash
pnpm canary -- run --headless --no-open --config examples/improvement-demo/canary.config.ts
pnpm canary -- improve <baselineRunId>
pnpm canary -- suggest <baselineRunId> --accept suggestion_<baselineRunId>_broken_1
pnpm canary -- suggest <baselineRunId> --verify suggestion_<baselineRunId>_broken_1
pnpm canary -- candidate <baselineRunId> --entry ./fixed-agent.mjs --headless --no-open --config examples/improvement-demo/canary.config.ts
```

`--config` 把 Agent/cases 解析到配置文件目录，artifact 仍写在当前工作目录的 `.canary/artifacts`。Canary never writes Agent source. `candidate --entry` points at the human-fixed module; `compare` rejects holdout or baseline regressions.
