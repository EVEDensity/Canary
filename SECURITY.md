# Security policy

Canary is a local-first Preview project. Security fixes target the current main branch; older Preview versions do not have a separate maintenance guarantee. There is no security certification or guaranteed response time.

## Reporting a vulnerability

When GitHub private vulnerability reporting is enabled, use [Report a vulnerability](https://github.com/EVEDensity/Canary/security/advisories/new) in this repository's Security tab. The form requires repository setup and is not asserted to be available before that setup or while the repository is private.

If the form is unavailable, use the [feature request template](https://github.com/EVEDensity/Canary/issues/new?template=feature.yml&title=Security%20contact%20request) to ask **only for a private security contact**. A maintainer should arrange the private channel before receiving details. Do not include credentials, private data, exploit steps or attachments in that public request. This is a coordination fallback, not a private report; no public security email is currently declared.

Private reports should identify the affected commit/version, environment, reproduction and impact. Use synthetic data where possible. Do not send real model keys or unredacted production traces.

## Execution and network boundaries

- Canary executes project commands and code. It is not an operating-system sandbox; use an externally managed sandbox for untrusted projects.
- Keep the report server on loopback. Local clients can read the page and its operator token; the token does not isolate users or untrusted local processes. Do not expose the server through public tunnels or treat it as an account authentication service.
- Deterministic local checks do not require a model. Configured commands, Agent adapters, evaluators, exporters and tools may contact external services or consume model budget.
- Installers, configuration modules and tests are executable code. Review their source and selected Git version before running them.

## Evidence and secrets

Manifest hashes detect changes to sealed artifact content; they do not prove imported data is truthful, authorize disclosure or prevent local file access.

Canary applies redaction on supported paths. Logs, custom output, source snapshots, environment data and screenshots still require review before sharing. Use local environment variables or a controlled credential provider. Never commit `.env` files, private keys, real API tokens, user data or raw production traces. Revoke compromised credentials at their provider; deleting the latest file does not revoke them.

## Dependency maintenance

The lockfile and pinned package manager define the reviewed graph. Run `pnpm audit --json` and inspect advisory paths and execution conditions; `pnpm audit --prod` alone excludes development tools used to build and test the source.

Apply compatible security fixes and validate affected behavior. Keep raw audit and verification records under ignored `.canary/logs/`; commit only reviewed summaries. Font and icon licenses remain attached to distributed assets.
