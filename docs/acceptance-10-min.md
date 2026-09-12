# 10-minute new-user acceptance

Recorded 2026-09-12 against this repository. Goal from the architecture report: after install, a new user can run the local Demo and see the page within 10 minutes.

**No global npm install.** Use the cloned workspace only.

## Checklist

| Step              | Command / check                                                                         | Result                                                                        |
| ----------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1. Install        | `corepack enable` then `pnpm install`                                                   | Required                                                                      |
| 2. Default suite  | `pnpm demo:headless`                                                                    | **15 passed / 0 failed**, coverage `final`, hard gate pass                    |
| 3. UI             | `pnpm demo` opens `http://127.0.0.1:<port>/?runId=…`                                    | Overview, Timeline, Feature Coverage, Case Detail, Improvement Queue, Compare |
| 4. No-JS snapshot | Same URL with JavaScript disabled                                                       | `Snapshot (no JavaScript)` + JSON/Markdown links                              |
| 5. Reports        | `.canary/artifacts/<runId>/report.md` and `report.xml`                                  | Present                                                                       |
| 6. Replay         | `pnpm canary -- replay <runId> --headless --no-open`                                    | New run tagged `replayOf`                                                     |
| 7. MCP demo       | `pnpm canary -- run --headless --no-open --config examples/mcp-agent/canary.config.ts`  | 1 passed, coverage `unavailable`                                              |
| 8. Loop demo      | `pnpm canary -- run --headless --no-open --config examples/loop-agent/canary.config.ts` | 2 passed; expected loop does not trip hard gate                               |
| 9. Docs           | README Quick Start + `docs/getting-started.md`                                          | Linked from README                                                            |

## Evidence from this workspace

- Default run `run_84b28632-1519-46cd-af65-c1e2e1e30cd1`: 15/15, lines 98.73%, functions 100%, branches 77.08%.
- UI screenshot: [`docs/images/ui-overview.png`](./images/ui-overview.png).

## Out of scope for this clock

Publishing `@canary/*` to npm (optional release path only), cloud judges, and non-Node languages.
