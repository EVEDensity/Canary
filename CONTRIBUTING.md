# Contributing to Canary

Canary is a Preview project. Start with the [roadmap](docs/roadmap/README.md) and [support matrix](docs/guides/support-matrix.md); planned features are not implemented capabilities. Discuss public contract or scope changes before a large implementation.

## Development

Use Node.js 24, Git and pnpm 10.15.0. The source toolchain includes ESLint 10, which requires Node 22.13+ or 24+. Respect the root `packageManager` pin.

```bash
git clone https://github.com/EVEDensity/Canary.git
cd Canary
pnpm install --frozen-lockfile
pnpm build
```

Workspace exports use built `dist` files. Build before running CLI examples or integration tests. `pnpm demo` runs the explicit Agent demo; `pnpm canary run --port 4318 --no-open` runs this repository's project plan and starts its report page.

## Validation

Run checks appropriate to the change, for example:

```bash
pnpm build
pnpm --filter @canary/trace test
pnpm typecheck
pnpm lint
pnpm format:check
```

`pnpm check` runs workspace type checks, tests, lint and document formatting. Shared schema or test-framework changes need workspace tests. Documentation changes need formatting and link/configuration checks. Do not remove assertions, raise timeouts or weaken gates just to make a failed run pass.

The project uses Vitest 4.1.11 or newer within major 4. Review migration notes and keep companion packages compatible. The scoped `brace-expansion` override in `pnpm-workspace.yaml` patches affected 5.x versions only; recheck its need when upstream dependency ranges change.

## Local logs and evidence

`pnpm test` writes logs under `.canary/logs/`. Log another command using:

```bash
node scripts/run-logged.mjs verification/my-change -- pnpm build
pnpm logs:status
pnpm logs:prune
```

The prune command previews eligible logs; deletion requires `pnpm logs:prune -- --apply`. Inspect the preview first. Unknown, incomplete and active records are protected. Preserve original failures when a later retry passes.

New logs, credentials, environment files and run artifacts must remain untracked. Existing historical evidence is retained; ignore rules do not remove tracked files. Review `git status`, `git diff --cached --stat` and staged content before committing. Never commit real credentials, raw user data or unreviewed screenshots.

## Pull requests and issues

- Use Conventional Commits, such as `fix(trace): preserve failure evidence`.
- Describe user-visible changes, validation and uncovered limits.
- Preserve artifact and CLI/schema compatibility or document the migration.
- Update related guides and support scope. Mark tasks complete only with actual evidence.
- Distinguish deterministic facts, inferred impact and model advice. Skipped is not passed; coverage is not behavioral correctness.

GitHub workflow execution and native macOS/Ubuntu checks will be supplemented after the source opening. An infrastructure-blocked workflow is not a passing verification record. Ordinary contributions do not require a paid model or remote publication.

Use [Issue templates](https://github.com/EVEDensity/Canary/issues/new/choose). Include versions, OS, invocation directory, relevant configuration, expected/actual behavior and a redacted reproduction. `canary version --json`, `canary paths --json` and `canary doctor --json` help collect diagnostics; review values and paths before sharing them.

Follow [SECURITY.md](SECURITY.md) for vulnerabilities. Do not post exploitation details or secrets in a public Issue.

## Licensing

Contributions are distributed under Apache-2.0. Contribute only material you are entitled to share and retain third-party notices. Fonts and icons have accompanying licenses that must remain with the corresponding assets.
