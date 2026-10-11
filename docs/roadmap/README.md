# Product roadmap

Canary connects project checks, architecture, coverage and failure evidence. Distribution uses GitHub source and Releases.

R16–R24 have implemented workflows within the documented support boundaries.

- **[R16 — Unified failure evidence](https://github.com/EVEDensity/Canary/issues/1):** structured diagnostics, conservative failure grouping and exportable evidence bundles.
- **[R17 — Pull request integration](https://github.com/EVEDensity/Canary/issues/2):** CI summaries, version-bound results and optional source annotations.
- **[R18 — Reproduction](https://github.com/EVEDensity/Canary/issues/3):** versioned execution instructions, isolated workspaces and explicit environment requirements.
- **[R19 — Repair verification](https://github.com/EVEDensity/Canary/issues/4):** compare failures and fixes, validate regression tests and detect weakened verification.
- **[R20 — Change verification](https://github.com/EVEDensity/Canary/issues/5):** connect changes to execution coverage, assertions and declared project contracts.
- **[R21 — Delivery](https://github.com/EVEDensity/Canary/issues/6):** consistent installation, documentation, compatibility and release validation.
- **R22 — Trusted evidence and state:** scoped experience selection is separate from function-context delivery; bounded, redacted process output is retained; corrupt experience records and pointers block mutation. Delivery confirms a context argument, not agent use or improvement.
- **R23 — Official Skill delivery:** a short `canary-verify` Skill with conditional references, project installation, hash records, explicit updates, conflict protection, rollback and removal. Client discovery and invocation have not been tested across every Agent Skills client.
- **R24 — Unified CLI/MCP verification entry points:** project-bound failure diagnostics, retained verification receipts and explicit reproduction/repair/change operations reuse the existing CLI evidence chain. Missing source identity, conditions or compatible receipts remain blocked, insufficient or unavailable.

**R25–R30 remain planned.** Priorities include controlled repair packages, broader change verification, project memory, delivery upgrades, performance/reliability and observability, and v1.0 acceptance. Scope will follow usage feedback and measured gaps.

Contributions should preserve existing CLI contracts and evidence integrity. Discuss substantial changes in a repository Issue before implementation.
