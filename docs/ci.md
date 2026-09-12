# CI

GitHub Actions workflow: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

**Local development does not use npm global install.** Contributors and CI both run from the cloned workspace:

```powershell
pnpm install
pnpm demo:headless
```

| Job                                       | What                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| format / lint                             | `pnpm format:check`, `pnpm lint`                                               |
| Node 24                                   | `build`, `typecheck`, `test`                                                   |
| coverage fixture                          | Dedicated job: `@canary/coverage` fixture matrix (not folded into `pnpm test`) |
| Demo local-agent / mcp-agent / loop-agent | `build` then `pnpm demo:headless` or example configs                           |
| Bun smoke                                 | CLI `help` under Bun; must print `Usage: canary run` (no V8 coverage claim)    |
| release pack smoke                        | `pnpm pack` tarball sanity check before npm publish (not day-to-day dev)       |

**Node version policy:** CI runs on **Node 24** (v0.1 baseline). Local development supports **Node ≥22**; the matrix no longer duplicates Node 22 because both jobs ran the same suite and doubled CI time without adding signal.

The default demo job mirrors the personal-developer path: install → **`pnpm build`** → `pnpm demo:headless` → JUnit assert. Build is required because the demo agent imports workspace packages via their compiled `dist/` exports.

Tag `v*` runs [`.github/workflows/release.yml`](../.github/workflows/release.yml): provenance publish and GitHub Release assets. Set `NPM_TOKEN`. Publishing is optional; running canary from the repo never requires it.
