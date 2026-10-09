# Product roadmap

Canary connects project checks, architecture, coverage and failure evidence. Upcoming work focuses on change verification and the repair workflow within existing CI.

R16–R21 are implemented in this revision. The next roadmap will be based on usage feedback and measured validation gaps.

- **[R16 — Unified failure evidence](https://github.com/EVEDensity/Canary/issues/1):** structured diagnostics, conservative failure grouping and exportable evidence bundles.
- **[R17 — Pull request integration](https://github.com/EVEDensity/Canary/issues/2):** CI summaries, version-bound results and optional source annotations.
- **[R18 — Reproduction](https://github.com/EVEDensity/Canary/issues/3):** versioned execution instructions, isolated workspaces and explicit environment requirements.
- **[R19 — Repair verification](https://github.com/EVEDensity/Canary/issues/4):** compare failures and fixes, validate regression tests and detect weakened verification.
- **[R20 — Change verification](https://github.com/EVEDensity/Canary/issues/5):** connect changes to execution coverage, assertions and declared project contracts.
- **[R21 — Delivery](https://github.com/EVEDensity/Canary/issues/6):** consistent installation, documentation, compatibility and release validation.

Contributions should preserve existing CLI contracts and evidence integrity. Discuss substantial changes in a repository Issue before implementation.
