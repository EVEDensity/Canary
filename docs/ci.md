# CI

`.github/workflows/ci.yml`:

| Job                                       | What                                               |
| ----------------------------------------- | -------------------------------------------------- |
| format / lint                             | `pnpm format:check`, `pnpm lint`                   |
| Node 22 / 24                              | `typecheck`, `test`, `build`                       |
| coverage fixture                          | `@canary/coverage` fixture matrix                  |
| Demo local-agent / mcp-agent / loop-agent | `canary run --headless --no-open`                  |
| Bun smoke                                 | CLI `help` under Bun (no V8 coverage claim)        |
| npm pack / bin                            | pack `@canary/cli` and run `help` from the tarball |

Tag `v*` runs `.github/workflows/release.yml`: provenance publish and GitHub Release assets. Set `NPM_TOKEN`.
