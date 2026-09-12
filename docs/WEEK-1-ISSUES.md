# Canary Week 1 — Real Validation Results and Remaining Limits

> Validation date: **September 12, 2026**
> 
> Rule for this report: only commands and runtime paths that were actually executed are marked `PASS`.

## Delivered scope

- Normalized workspace package exports, TypeScript project references, and empty-package Vitest behavior.
- Frozen the coverage contracts in `@canary/core`; implemented Node/V8 collection in the **agent execution child process**.
- Implemented Runner lifecycle management: child process launch, runtime error propagation, timeout, cancellation, cleanup, and coverage delivery.
- Implemented CLI orchestration, local artifact writing, RunStore propagation, local Web UI, HTTP coverage endpoint, and SSE subscriber cleanup.
- Added and exercised coverage contract/summary/collector tests, Runner lifecycle tests, Web/SSE tests, and a CLI headless E2E test.

## Final validation matrix

| Check | Actual command / verification | Result | Evidence |
|---|---|---|---|
| Local dependency links | `pnpm install --offline` | **PASS** | pnpm `10.15.0`; `Already up to date`; no network download or registry-metadata lookup (`downloaded 0`). |
| Workspace typecheck | `pnpm typecheck` | **PASS** | All 12 workspace projects completed TypeScript checking. |
| Full tests | `pnpm test` | **PASS** | Coverage: 3 files / 6 tests; Runner: 1 file / 4 tests; Web: 1 file / 2 tests; CLI: 1 file / 1 test. Empty workspace packages use `--passWithNoTests`. |
| Workspace build | `pnpm build` | **PASS** | All 12 workspace projects built. |
| Dist exports | Existence check after build | **PASS** | Verified `dist/index.js` and `dist/index.d.ts` for core, coverage, runner, CLI, and Web (10 expected files). |
| CLI headless E2E test | `pnpm --filter @canary/cli test` | **PASS** | Writes an artifact and asserts non-zero coverage reaches both `run.json` and `RunStore`. |
| Real CLI headless execution | `pnpm canary -- --headless --no-open` | **PASS** | Executed the TypeScript root config and one TypeScript agent case successfully. |
| Artifact verification | Read generated `.canary/artifacts/<runId>/run.json` | **PASS** | See the recorded run below. |
| Web coverage endpoint | Started a non-headless local run and fetched `/api/runs/:runId/coverage` | **PASS** | HTTP `200`; `coverageStatus: final`; `lineTotal: 1`; `RunStore` had coverage. |
| SSE subscriber release | Connected to `/api/runs/run_sse_manual/events`, destroyed client response, then inspected `RunStore` | **PASS** | `subscriberCountAfterClientClose: 0`. |

## Recorded runtime evidence

### Real CLI headless run

Executed:

```powershell
pnpm canary -- --headless --no-open
```

Recorded artifact:

```text
C:\Users\temp-admin\Desktop\Canary\.canary\artifacts\run_2f1cc8e8-775b-4066-a58c-e4a6d9864913\run.json
```

Observed result:

```text
status: completed
cases: 1 total / 1 passed
coverage status: final
lines: 1 covered / 1 total
functions: 0 covered / 2 total
branches: 0 covered / 2 total
```

The zero function/branch result is a known source-to-V8 mapping limitation, not a missing coverage message; see “Remaining limits”.

### Web coverage endpoint

A live, non-headless execution produced run ID:

```text
run_e8f6a811-ce34-4d22-9a2b-5fbf58d32d85
```

The local HTTP validation returned:

```json
{
  "exitCode": 0,
  "httpStatus": 200,
  "coverageStatus": "final",
  "lineTotal": 1,
  "runStoreCoverage": true
}
```

Endpoint validated:

```text
/api/runs/run_e8f6a811-ce34-4d22-9a2b-5fbf58d32d85/coverage
```

### SSE cleanup

The direct server/client validation returned:

```json
{
  "subscriberCountAfterClientClose": 0
}
```

This confirms `request.close` / `response.close` cleanup removes the SSE subscriber from the in-memory `RunStore`.

## Real failures found and fixed in this validation cycle

1. **Runner successful execution returned `passed=false`.**
   - Cause: the dynamically generated child code emitted an invalid nested template literal; the child exited with code `1`.
   - Fix: simplified the execution child so the Node/V8 inspector and the agent execute in the same isolated child process. The child sends `result`, `error`, and final `coverage` IPC messages before disconnecting.

2. **Windows ESM file URL handling failed.**
   - Cause: `new URL(absoluteWindowsPath, "file:")` created a `c:` URL that Node rejected.
   - Fix: use `pathToFileURL()` in Runner and `fileURLToPath()` with a cross-platform fixture fallback in Coverage.

3. **Timeout/cancel test agents exited too early.**
   - Cause: a never-settling Promise alone does not keep a Node event loop alive.
   - Fix: keep the execution child alive while the agent Promise is pending, and clear that handle in normal finalization. Timeout/cancel tests now pass.

4. **CLI root invocation looked for config under `packages/cli`.**
   - Cause: pnpm filtered scripts set the package directory as the current process directory.
   - Fix: CLI defaults to `INIT_CWD` when no explicit `cwd` is supplied.

5. **CLI case glob produced zero selected cases.**
   - Cause: the initial minimal glob conversion incorrectly turned `cases/**/*.ts` into a non-existent `cases.ts` path.
   - Fix: recursively discover matching case files under the static portion of the configured glob.

6. **CLI TypeScript config/case module loading produced a nested default export.**
   - Cause: `tsx/esm/api` can expose `default.default` under the active Node/tsx interop path.
   - Fix: unwrap this interop shape consistently for config and case modules.

7. **Root coverage was final but had no configured files.**
   - Causes: an absolute-pattern conversion in CLI and incorrect Windows normalization / `**/` matching in Coverage.
   - Fix: preserve root-relative coverage patterns in CLI; normalize V8 file URLs correctly; implement optional-directory `**/` glob behavior.

## Remaining limits / follow-up work

1. **Coverage precision — important.** The current branch, function, and statement mapping is source-text heuristic based. V8 offsets from `tsx`-transpiled TypeScript can differ from original source offsets; therefore executed functions/branches can undercount (as in the recorded root run). Do not use these MVP percentages as Istanbul/AST-grade threshold enforcement.
2. **Coverage update cadence.** Runner currently publishes the final coverage summary after each execution. Continuous in-flight coverage samples and per-feature live progress are not yet surfaced to the UI.
3. **Run persistence.** `RunStore` is in-memory. `run.json` is persisted, but startup replay and artifact-backed history browsing are not implemented.
4. **Case discovery.** The MVP recursively loads JavaScript/TypeScript files under the static prefix of a glob. It is not a full glob engine and does not yet support sophisticated include/exclude semantics.
5. **Evaluator semantics.** The Runner currently asserts execution completion. Domain assertions, trajectory quality evaluators, loop detection, and feature-level pass/fail gates are follow-up work.
6. **CLI distribution packaging.** Development/root execution (`pnpm canary`) and the programmatic CLI E2E are verified. A published-package `bin` wrapper/shebang test on a clean consumer project remains a release-hardening task.
7. **Sandbox controls.** Execution uses a subprocess boundary, but it does not yet enforce filesystem/network permissions or resource quotas beyond timeout/cancellation.

## Toolchain observed

```text
Node: v24.18.0
npm: 11.16.0
Corepack: 0.35.0
pnpm: 10.15.0
TypeScript: 5.9.3
Vitest: 3.2.7
```


## Follow-up validation after P0 continuation (2026-09-12)

### Source mapping and Feature Coverage

- Added `packages/coverage/src/source-mapping.ts` with local inline/external source-map loading, Windows/file URL canonicalization, source-content hash validation, and explicit `exact`/`approximate`/`unknown` quality diagnostics.
- Added generated/original source-map regression coverage. The test confirms a shifted generated V8 range is attributed to the original TypeScript file and is marked `source-map` + `approximate` rather than falsely claiming exactness.
- Added branch/function/error/unloaded fixture files and an expected coverage matrix under `packages/coverage/tests/fixtures/`.
- Added Feature status matrix tests for covered/partial/uncovered/failed/unavailable and multi-case identity union.

### Real command results

| Command | Result | Details |
|---|---|---|
| `pnpm typecheck` | PASS | All 12 participating workspace projects passed. |
| `pnpm test` | PASS | Coverage: 3 files / 13 tests; Runner: 1 / 4; Web: 1 / 2; CLI: 1 / 1; evaluator: 1 / 4. Empty packages use `--passWithNoTests`. |
| `pnpm build` | PASS | All workspace builds passed. |
| `pnpm canary -- --headless --no-open` | PASS | Run `run_08987f4d-f336-4fb3-88c4-5dfdb0753d78`; status `completed`; coverage `final`; lines `2/2`. |
| artifact validation | PASS | `.canary/artifacts/run_08987f4d-f336-4fb3-88c4-5dfdb0753d78/run.json`, `coverage.json`, and `coverage-manifest.json` exist. |
| Web coverage API | PASS | Run `run_d5aaf817-ecff-4411-93ee-98db10331cbd`; HTTP `200`; `/api/runs/:runId/coverage` returned `status: final`. |
| SSE subscriber cleanup | PASS | Direct HTTP validation confirmed zero subscribers after client close; Web test also passes. |

### Current limitations

1. Source-map location attribution is deliberately `approximate` at token/segment granularity; exact branch/function mapping still requires a compiler-specific instrumenter or richer generated-range metadata.
2. The generated child currently supplies `Debugger.getScriptSource`; source-map URL discovery is supported, but remote maps are rejected and no network fetch is attempted.
3. Feature `covered` requires both a completed feature event and complete selected coverage; completion alone is classified as `partial` when source coverage is incomplete.
4. RunStore remains in-memory; artifacts are persisted but not replayed automatically at Web startup.
5. The subprocess boundary is not a security sandbox and does not yet enforce filesystem/network quotas.

## P1 continuation validation (2026-09-12)

Implemented:
- provisional V8 coverage sampling over child IPC with configurable `sampleIntervalMs` and final coverage cleanup;
- RunStore coverage fingerprint de-duplication and subscriber count diagnostics;
- file-backed `FileArtifactRepository` with `listRuns`, `readRun`, `readCoverage`, and Web startup hydration;
- CLI artifact emission for `trajectory.json` and `evaluator.json`;
- case discovery supporting include arrays, stable ordering, duplicate IDs, schema diagnostics, no-match errors, and `.ts/.mts/.cts/.js/.mjs` files.

Validation:
- `pnpm typecheck`: PASS
- `pnpm build`: PASS
- `pnpm --filter @canary/runner test`: PASS (4 tests)
- `pnpm --filter @canary/cli test` after build: PASS (1 test)
- Full `pnpm test` before rebuilding package dist: FAIL due stale workspace dist consuming pre-change Runner output; rebuilding with `pnpm build` then rerunning affected CLI test: PASS.

Known limitation: workspace package tests that import package exports require a current build because package exports resolve `dist`; CI must run build before cross-package tests or use source aliases.
