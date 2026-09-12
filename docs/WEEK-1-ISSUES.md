# Canary Week 1 Issues

## Scope delivered

- Normalized workspace package exports and CLI `bin` to `dist/index` output.
- Reworked TypeScript project references and source/dist boundaries.
- Frozen coverage contracts in `@canary/core` and added branch/function/error/unloaded fixtures and summary tests.
- Added Node/V8 coverage collection inside the execution child isolate.
- Added Runner timeout, cancellation signal, child cleanup, and idempotent collector stop behavior.
- Added Web RunStore coverage endpoint, coverage dashboard section, and SSE disconnect cleanup.
- Added CLI detailed headless orchestration with artifact path and RunStore access for E2E assertions.

## Real validation log — September 12, 2026

### Static syntax

- `node --check packages/runner/src/index.ts`: PASS.
- `node --check packages/cli/src/index.ts`: PASS.
- `node --check apps/web/src/index.ts`: PASS.
- `node --check packages/coverage/src/index.ts`: PASS.

### Dependency installation

- `pnpm install --reporter append-only`: TIMEOUT after 240 seconds while recreating `node_modules`.
- `pnpm install` without CI mode: aborted because pnpm could not remove modules without a TTY.
- Environment used the fallback pnpm 11.19.0 executable.

### Typecheck

- Workspace `pnpm typecheck`: TIMEOUT while pnpm attempted registry policy/attestation requests; registry requests returned `EACCES`.
- Direct TypeScript 5.9.3 build: FAIL. Initial failures include incomplete dependency links/types, coverage parser syntax error, and project configuration/runtime typing issues. This is not a passing typecheck.

### Tests

- `pnpm test`: NOT RUN to completion because dependency installation did not complete and the workspace runner remained unable to resolve dependencies reliably.
- Vitest suites therefore remain unverified in this environment.

### CLI E2E and artifact verification

- Headless CLI E2E test was added but NOT RUN to completion for the same dependency/install blocker.
- `.canary/artifacts/<runId>/run.json` writing is implemented in `packages/cli/src/index.ts`; existence and JSON assertions are covered by the new E2E test, but no successful runtime result is claimed.
- Coverage propagation is implemented through `runExecution -> onCoverage -> RunStore.setCoverage`; runtime verification remains pending.

## Known limitations

- Branch and statement mapping currently use conservative source-text heuristics; this is not AST/Istanbul-level precision.
- V8 coverage is isolate-local and must be collected in the execution child.
- RunStore is in-memory; artifact-backed replay is not implemented.
- SSE does not yet replay by `Last-Event-ID`.
- CLI case discovery remains intentionally small and needs robust glob support.
- Threshold enforcement and richer evaluator assertions remain follow-up items.

## Toolchain

- Node: v24.18.0.
- npm: 11.16.0; use `npm.cmd` in this PowerShell environment.
- Corepack: 0.35.0.
- pnpm fallback runtime: 11.19.0.

## Remaining blockers

1. Restore package registry access or provide complete local pnpm metadata/cache.
2. Run a clean `pnpm install` to completion.
3. Run and fix `pnpm typecheck`, including remaining Node typings and coverage/Runner errors.
4. Run `pnpm test`, CLI headless E2E, and Web/SSE HTTP tests.
5. Run `pnpm build` and verify package exports against actual `dist/index.*` files.
