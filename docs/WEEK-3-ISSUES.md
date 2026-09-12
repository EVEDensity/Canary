# Canary Week 3 — Real Validation Results

> Validation date: **September 12, 2026**
>
> Rule: only commands and runtime paths that were actually executed are marked `PASS` or `FAIL`.

## Delivered scope

- JSON / Markdown / JUnit reporters written from run artifacts; failed runs keep exit code 1.
- Demo Agent now has planning, tool routing, error recovery, loop stop, and termination branches.
- 14 capability cases (13 smoke + 1 holdout): tool failure recovery, loop stop, forbidden tool, max steps, isolation, schema.
- Improvement suggestions from failed cases; `compare` rejects regressions and does not rewrite user source.
- HTTP AgentAdapter returns `coverage.status=unavailable`; MCP stdio ToolAdapter is separate from AgentAdapter.
- Trace redaction/truncation/query; Web history list + case trajectory + `/report/:format`.
- Coverage `summarizeCoverage` ops/sec benchmark.

## Final validation matrix

| Check | Actual command / verification | Result | Evidence |
|---|---|---|---|
| Typecheck | `pnpm typecheck` | **PASS** | 12 workspace projects. |
| Build | `pnpm build` | **PASS** | All packages built. |
| Full tests | `pnpm test` | **PASS** | Coverage 19; Evaluators 4; Adapters 3; Improvement 3; Reporters 3; Trace 2; Runner 9; Web 5; CLI 3. |
| Root headless run | `pnpm canary -- run --headless --no-open` | **PASS** | 14/14 cases; exit 0. |
| Reports | artifacts `report.json` / `report.md` / `report.xml`; `canary report --format markdown` | **PASS** | JUnit `tests="14" failures="0"`. |
| Improve / compare | `pnpm canary -- improve …`; `pnpm canary -- compare A A` | **PASS** | Suggestions `[]` on a green run; verdict `keep`. |
| Coverage benchmark | `benchmarkCoverageSummarize(200)` | **PASS** | 3703.7 ops/sec, 54 ms, 200 iterations. |

## Recorded runtime evidence

### Root CLI

```powershell
pnpm canary -- run --headless --no-open
```

```text
runId: run_efbbdf59-cdc6-49cc-af8d-0025d77c2a90
status: completed
cases: 14 passed / 0 failed / 14 total
coverage: final · lines 55/56 (98.21%) · functions 14/14 (100%) · branches 33/44 (75%) · statements 57/64 (89.06%)
evaluation: 35 passed / 0 failed assertions
exit: 0
artifact: C:\Users\temp-admin\Desktop\Canary\.canary\artifacts\run_efbbdf59-cdc6-49cc-af8d-0025d77c2a90\run.json
```

Week 2 baseline on the same demo was `branches 1/2`. The expanded agent now exercises planning / routing / recovery / termination.

### Reports

```powershell
pnpm canary -- report run_efbbdf59-cdc6-49cc-af8d-0025d77c2a90 --format markdown
```

Markdown listed all 14 cases as PASS. `report.xml` is a JUnit testsuite with `failures="0"`.

### Improvement loop

A fully passing run exports `improvement.json` as `[]`. Unit tests cover suggestion export from failures and `verdict: "reject"` when a baseline-passing case fails in the candidate. `compare` of the recorded run against itself returned `keep`.

## Test counts from `pnpm test`

```text
Coverage     19 passed
Evaluators    4 passed
Adapters      3 passed
Improvement   3 passed
Reporters     3 passed
Trace         2 passed
Runner        9 passed
Web           5 passed
CLI           3 passed
```

## Known limits

1. Source-map coverage remains `approximate`; feature chains in the recorded run are `partial` even when cases pass.
2. MCP stdio adapter speaks newline-delimited JSON-RPC `tools/call`, not the full MCP SDK/session lifecycle.
3. HTTP AgentAdapter never fabricates source coverage; it reports `unavailable`.
4. Cancel/timeout remain Runner tests; they are not in the default 14-case demo so a green `canary run` stays deterministic and relatively fast.
5. Improvement never writes Agent source. Human approval is still `proposed → accepted/rejected → verified`.

## 未执行

- GitHub Actions Node 22/24 matrix
- Published npm `bin` on a clean consumer project
- Full MCP Streamable HTTP
- Automatic source patches
