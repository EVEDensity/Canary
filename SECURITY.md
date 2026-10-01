# Security policy

Security fixes target the current main branch.

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/EVEDensity/Canary/security/advisories/new) when available. Otherwise, open an Issue requesting a private contact without including vulnerability details, credentials or attachments.

A private report should include the affected version, impact and a minimal reproduction using synthetic data.

## Execution boundaries

- Canary executes project commands and configuration with host permissions. Use an external sandbox for untrusted projects.
- Keep the report server on loopback. Its operator token is not a multi-user authentication system.
- Configured adapters, commands and tools may contact external services.
- Artifact hashes detect content changes; they do not authenticate imported claims or authorize disclosure.

## Sensitive information

Review logs, reports, source snapshots and screenshots before sharing. Redaction covers supported output paths and cannot guarantee that custom output contains no sensitive information.

Never commit credentials, private keys, environment files, personal data or raw production traces. Store credentials through environment variables or a controlled provider. Revoke exposed credentials at their source.

## Dependencies

Keep the lockfile and package manager pin up to date. Review `pnpm audit --json`, apply compatible fixes and validate affected behavior. Store raw verification output in ignored `.canary/logs/`; retain distributed font and icon licenses.
