# Contributing to canary

canary is a TypeScript monorepo. Keep package boundaries: core contracts, runner execution, coverage collection, evaluators, and UI stay separate. Do not have the improvement loop write Agent source.

## Setup

```powershell
pnpm install
pnpm typecheck
pnpm test
pnpm lint
pnpm format:check
```

Node.js 22+. Enable Corepack once (`corepack enable`). No global npm install is required.

Use `pnpm demo:headless` for a no-UI check of the default suite (same command CI uses).

## Pull requests

- Add or update tests for public behavior.
- Coverage changes need a fixture assertion in `@canary/coverage`.
- Do not lower coverage denominators or fabricate `unavailable` as 0%/100%.
- Redact traces. Do not commit secrets or `.canary/artifacts`.

## Release

1. `pnpm changeset` for user-facing work after v0.1.0.
2. `pnpm changeset version` then commit CHANGELOG and version bumps.
3. Tag `vX.Y.Z` and push. GitHub Actions publishes with npm provenance when `NPM_TOKEN` is set.
