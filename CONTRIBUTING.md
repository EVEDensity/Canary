# Contributing to Canary

Bug reports, documentation improvements, translations and code contributions are welcome. For substantial changes, open an Issue to discuss scope and compatibility.

## Development

Use Node.js 24, Git and pnpm 10.15.0.

```bash
git clone https://github.com/EVEDensity/Canary.git
cd Canary
pnpm install --frozen-lockfile
pnpm build
```

Build workspace packages before running examples or integration tests. Preview the website with `pnpm site:dev`.

## Validation

```bash
pnpm check
pnpm site:build
pnpm i18n:check
```

Run the checks relevant to your change. Preserve assertions, public schemas, CLI exit codes and artifact compatibility. Document migrations when contracts change.

## Pull requests

- Describe the change and how it was verified.
- Update affected guides and translations.
- Use Conventional Commits, such as `fix(trace): preserve failure evidence`.
- Keep credentials, personal data and execution artifacts out of commits.

Test and verification logs belong in ignored `.canary/logs/`. Review staged files before submitting. Issue reports should include versions, expected and actual behavior, and a minimal reproduction with sensitive values removed.

Report vulnerabilities according to [SECURITY.md](SECURITY.md). Contributions use [Apache-2.0](LICENSE); retain applicable third-party license notices.
