# 10-minute new-user acceptance

Recorded 2026-09-12 against this repository. Goal: install once, then run `canary run` from any directory within 10 minutes.

## Checklist

| Step              | Command / check                                                                 | Result                                                                        |
| ----------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1. Install        | One-line global install (see below)                                             | Required                                                                      |
| 2. Default suite  | `canary run --headless --no-open`                                               | **15 passed / 0 failed**, coverage `final`, hard gate pass                    |
| 3. UI             | `canary run` opens `http://127.0.0.1:<port>/?runId=…`                           | Overview, Timeline, Feature Coverage, Case Detail, Improvement Queue, Compare |
| 4. No-JS snapshot | Same URL with JavaScript disabled                                               | `Snapshot (no JavaScript)` + JSON/Markdown links                              |
| 5. Reports        | `<CanaryHome>/.canary/artifacts/<runId>/report.md`                              | Present                                                                       |
| 6. Replay         | `canary replay <runId> --headless --no-open`                                    | New run tagged `replayOf`                                                     |
| 7. MCP demo       | `canary run --headless --no-open --config examples/mcp-agent/canary.config.ts`  | 1 passed, coverage `unavailable`                                              |
| 8. Loop demo      | `canary run --headless --no-open --config examples/loop-agent/canary.config.ts` | 2 passed; expected loop does not trip hard gate                               |
| 9. Docs           | README Quick Start + `docs/getting-started.md`                                  | Linked from README                                                            |

## One-line install

**Windows (PowerShell):**

```powershell
git clone https://github.com/EVEDensity/Canary.git "$env:USERPROFILE\Canary"; node "$env:USERPROFILE\Canary\scripts\install-global.mjs"
```

Open a **new terminal**, then `canary run`.

## Evidence from this workspace

- Global run from `%TEMP%`: 15/15, lines 98.73%, branches 77.08%.
- Registry: `%USERPROFILE%\.canary\home.json` → project root.

## Out of scope for this clock

Optional npm publish, cloud judges, and non-Node languages.
