# CI and validation

Canary integrates with existing CI through stable exit codes and JSON, JUnit and Markdown reports.

```bash
canary run --ci
canary doctor --json
```

Prepare project dependencies and required services before execution. Explicit configuration takes priority over discovery. CI mode does not start the report server.

## Repository validation

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm check
pnpm test:quick
pnpm i18n:check
pnpm site:build
```

Workflows live in `.github/workflows/`. Preserve failure artifacts and the original check exit code. A configured job is separate from an executed verification result.

`test:quick` covers local logs, official Skill install/update/conflict/rollback/removal, stable Release resolution, runtime inventory and recoverable upgrades. Network failure cases use bounded fixtures; upgrade tests also clone a real local Git source and start both versions. The Node CI and GitHub Release validation run it after building, alongside the existing full tests. Releases run only from the existing main success/manual conditions, attach the official Skill ZIP and include it in `SHA256SUMS`; no npm publication job is configured.

See [CLI contract](r0-cli-contract.md), [configuration](r4-project-checks.md) and [support scope](support-matrix.md).
