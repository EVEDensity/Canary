# Canary Week 1 Issues

## Completed in this iteration

- Normalized package entry points to `dist` artifacts.
- Added explicit TypeScript project references.
- Added frozen coverage contracts in `@canary/core`.
- Reworked Node/V8 coverage lifecycle and execution-child collection.
- Added runner lifecycle and Web HTTP/SSE test scaffolds.

## Known limitations

- Branch and statement mapping currently use conservative source-text heuristics; AST/source-map precision is a follow-up.
- Coverage is isolate-local and must be collected in the execution child.
- RunStore is still in-memory; artifact-backed replay is not implemented.
- SSE does not yet replay by `Last-Event-ID`.
- CLI case discovery remains intentionally small and should gain robust glob support.
- Threshold enforcement and richer evaluator assertions remain follow-up items.

## Environment

- Node: v24.18.0
- npm: 11.16.0 (`npm.cmd` is required on this PowerShell environment).
- Corepack: 0.35.0
- pnpm: 11.19.0 fallback runtime.
- Dependency installation was blocked by missing offline metadata and the networked install approval was unavailable.

## Next validation

Run after dependencies are available:

```powershell
pnpm install
pnpm typecheck
pnpm test
pnpm --filter @canary/cli canary -- run --headless
```
