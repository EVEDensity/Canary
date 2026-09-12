# Contributing to canary

canary is a TypeScript monorepo. Keep package boundaries: core contracts, runner execution, coverage collection, evaluators, and UI stay separate. The current improvement workflow must not be treated as an authorized source-editing loop. Future opt-in hard evolution requires the independent policy, isolation, validation and application controls in [the roadmap](docs/roadmap/README.md); that roadmap does not itself authorize implementation.

## Setup

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
pnpm lint
pnpm format:check
```

Node.js 22+. Enable Corepack once (`corepack enable`). No global npm install is required.

Use `pnpm demo:headless` for a no-UI check of the default suite (same command CI uses).

## Documentation and task scope

Read [the documentation index](docs/README.md), [current code audit](docs/evidence/code-audit.md) and [task working protocol](docs/roadmap/00-working-protocol.md). Update current guides only for implemented behavior; keep goals in design and pending work in roadmap. Historical reports belong in archive, with useful measurements indexed under evidence.

## Pull requests

- Add or update tests for public behavior.
- Coverage changes need a fixture assertion in `@canary/coverage`.
- Do not lower coverage denominators or fabricate `unavailable` as 0%/100%.
- Redact traces. Do not commit secrets or `.canary/artifacts`.

## Release

1. `pnpm changeset` for user-facing work after v0.1.0.
2. `pnpm changeset version` then commit CHANGELOG and version bumps.
3. Review `.github/workflows/release.yml`, package publishability and credentials before tagging `vX.Y.Z`. A configured workflow or `NPM_TOKEN` alone is not evidence that packages have been published successfully.
