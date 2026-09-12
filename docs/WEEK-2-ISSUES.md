# Canary Week 2 — Real Validation Results

> Validation date: **September 12, 2026**
>
> Rule: only commands and runtime paths that were actually executed are marked `PASS` or `FAIL`. Items not run are marked **未执行**.

## Delivered scope

- Fixed Case Discovery so `**` matches zero or more directories (`cases/smoke.ts` and `cases/a/b.ts`).
- Root `canary.config.ts` still uses `./examples/local-agent/cases/**/*.ts` and now discovers `examples/local-agent/cases/smoke.ts`.
- CLI commands: `canary run`, `canary runs`, `canary show <runId>`.
- Run summary printed at the end of `run` (runId, cases, coverage, evaluation, artifact, UI URL, exit code).
- `trajectory.json` now stores full events; `evaluator.json` stores execution/evaluation records.
- Runner attaches `trajectory` on `EvalResult`; timeout / cancel / runtime error / assertion failure remain distinct.
- Coverage fixtures + expected matrix; provisional sampling with min-interval and fingerprint de-duplication.
- Web Artifact Replay hydrate, provisional/final SSE, multi-client SSE cleanup.

## Final validation matrix

| Check | Actual command / verification | Result | Evidence |
|---|---|---|---|
| Workspace typecheck | `pnpm typecheck` | **PASS** | 12 workspace projects completed. |
| Workspace build | `pnpm build` then `pnpm --filter @canary/cli build` after JSDoc fix | **PASS** | All packages built. First CLI build **FAIL** (block comment in `globToRegExp` JSDoc contained `*/`); comment rewritten, rebuild **PASS**. |
| Full tests | `pnpm test` | **PASS** | Coverage 18; Evaluators 4; Runner 8; Web 5; CLI 3. Empty packages `--passWithNoTests`. |
| Coverage fixtures | `pnpm --filter @canary/coverage test` | **PASS** | 4 files / 18 tests including `coverage-fixtures.test.ts`. |
| Runner matrix + sampling | `pnpm --filter @canary/runner test` | **PASS** | 8 tests: completed, error, timeout, cancel, assertion pass/fail, missing required event, provisional throttle. |
| Web SSE / replay | `pnpm --filter @canary/web test` | **PASS** | 5 tests: HTTP coverage, client close, artifact hydrate, provisional SSE, multi-client. |
| CLI E2E + discovery | `pnpm --filter @canary/cli test` | **PASS** | 3 tests: glob `**`, invalid/duplicate/empty schema, headless artifact write. |
| Root headless run | `pnpm canary -- run --headless --no-open` | **PASS** | See recorded run below. Previously this command **FAIL**ed with `No test case files matched: ./examples/local-agent/cases/**/*.ts`. |
| Artifact files | Read generated files under `.canary/artifacts/<runId>/` | **PASS** | `run.json`, `coverage.json`, `coverage-manifest.json`, `trajectory.json`, `evaluator.json`. |
| `canary runs` | `pnpm canary -- runs` | **PASS** | Listed 10 historical runs, newest first. |
| `canary show` | `pnpm canary -- show run_d91120c8-69f9-4102-99e2-c212a27e8132` | **PASS** | Printed run summary matching `run.json`. |

## Recorded runtime evidence

### Root CLI headless run

Executed:

```powershell
pnpm canary -- run --headless --no-open
```

Observed stdout:

```text
runId: run_d91120c8-69f9-4102-99e2-c212a27e8132
status: completed
cases: 1 passed / 0 failed / 1 total
coverage: final · lines 2/2 (100%) · functions 2/2 (100%) · branches 1/2 (50%) · statements 2/2 (100%)
evaluation: 2 passed / 0 failed assertions
artifact: C:\Users\temp-admin\Desktop\Canary\.canary\artifacts\run_d91120c8-69f9-4102-99e2-c212a27e8132\run.json
exit: 0
```

Artifact directory:

```text
C:\Users\temp-admin\Desktop\Canary\.canary\artifacts\run_d91120c8-69f9-4102-99e2-c212a27e8132\
```

Observed:

```text
coverage status: final
mappingMode: source-map
precision: approximate
feature planning: covered
trajectory events: feature.enter, feature.exit (status completed)
evaluator execution.status: completed
evaluator evaluation.status: passed
```

### CLI history

Executed:

```powershell
pnpm canary -- runs
pnpm canary -- show run_d91120c8-69f9-4102-99e2-c212a27e8132
```

`runs` printed the new run as the first row (`completed`, `1/1`). `show` reprinted the same coverage and evaluation summary and resolved the artifact path.

### Test counts from `pnpm test`

```text
Coverage     18 passed
Evaluators    4 passed
Runner        8 passed
Web           5 passed
CLI           3 passed
```

## Failures found and fixed in this cycle

1. **Root `canary run` matched zero cases.**
   - Cause: `globToRegExp` compiled `**/*.ts` as `.*/[^/]*\.ts`, which required an extra directory segment.
   - Fix: `**/` now compiles to `(?:.*/)?`.
   - Repro that previously failed: `pnpm canary -- run --headless --no-open`.
   - After fix: **PASS**.

2. **CLI build failed on a JSDoc comment.**
   - Cause: the comment text `**/*.ts` contains `*/` and closed the block comment.
   - Fix: rewrote the comment without that sequence.
   - `pnpm --filter @canary/cli build` then **PASS**.

## Known limits

1. Source-map location attribution remains `approximate` (`SOURCE_MAP_TOKEN_GRANULARITY`, `SOURCE_CONTENT_UNVERIFIED` on the recorded TS Agent run). Do not treat these percentages as Istanbul-exact gates.
2. Coverage sampling has min-interval + fingerprint de-duplication. The runner test asserts provisional events stay below a small bound; there is no separate ops/sec benchmark file.
3. `FileArtifactRepository` is synchronous local filesystem I/O. Fine for personal/small-team use, not a concurrent server store.
4. Execution isolation is a subprocess, not a filesystem/network sandbox.
5. `canary runs` / `show` read local `.canary/artifacts` only; they do not start a UI server.

## 未执行

- Published-package `bin` wrapper on a clean consumer project.
- Formal Coverage sampling throughput bench (numbers vs interval).
- MCP / HTTP Agent adapters as live execution paths.
