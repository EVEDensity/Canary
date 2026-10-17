# Product roadmap

Canary connects project checks, architecture, coverage and failure evidence. Distribution uses GitHub source and Releases.

R16–R28 have implemented workflows within the documented support boundaries.

- **[R16 — Unified failure evidence](https://github.com/EVEDensity/Canary/issues/1):** structured diagnostics, conservative failure grouping and exportable evidence bundles.
- **[R17 — Pull request integration](https://github.com/EVEDensity/Canary/issues/2):** CI summaries, version-bound results and optional source annotations.
- **[R18 — Reproduction](https://github.com/EVEDensity/Canary/issues/3):** versioned execution instructions, isolated workspaces and explicit environment requirements.
- **[R19 — Repair verification](https://github.com/EVEDensity/Canary/issues/4):** compare failures and fixes, validate regression tests and detect weakened verification.
- **[R20 — Change verification](https://github.com/EVEDensity/Canary/issues/5):** connect changes to execution coverage, assertions and declared project contracts.
- **[R21 — Delivery](https://github.com/EVEDensity/Canary/issues/6):** consistent installation, documentation, compatibility and release validation.
- **R22 — Trusted evidence and state:** scoped experience selection is separate from function-context delivery; bounded, redacted process output is retained; corrupt experience records and pointers block mutation. Delivery confirms a context argument, not agent use or improvement.
- **R23 — Official Skill delivery:** a short `canary-verify` Skill with conditional references, project installation, hash records, explicit updates, conflict protection, rollback and removal. Client discovery and invocation have not been tested across every Agent Skills client.
- **R24 — Unified CLI/MCP verification entry points:** project-bound failure diagnostics, retained verification receipts and explicit reproduction/repair/change operations reuse the existing CLI evidence chain. Missing source identity, conditions or compatible receipts remain blocked, insufficient or unavailable.
- **R25 — Controlled repair tasks:** bounded CLI/MCP handoffs bind sealed failures, source identity and declared repair scope. Candidate admission preserves original checks and requirements, reviews committed changes and test weakening, and remains separate from executed regression verification. See [repair tasks](../guides/repair-tasks.md).
- **R26 — Change evidence and verification gaps:** `run --base` and historical analysis produce one version-bound report for CLI, MCP and workspace views. Changed execution denominators, unknown files, explicit behavior and check scope remain separate; classified gaps link to sealed source. Missing execution identity and unsupported ranges remain unknown. See [change verification](../guides/change-verification.md).

- **R27 — Verified project repair memory:** explicitly retain verified repair facts with an operator, reason and expiry. Project/check/source-bound retrieval rechecks sealed history, budgets context and distinguishes related history from conditions requiring revalidation. CLI recording/revocation and read-only MCP/workspace lookup remain separate from Agent experience activation. See [project memory](../guides/project-memory.md).

- **R28 — Verified delivery and upgrades:** resolve published stable Releases to their tag commit; read-only update checks; preserve pinned channels; skip unchanged versions; reject accidental downgrade/version conflicts. Bind installed runtime files and dependencies to an inventory and verify rollback before execution. Source builds remain the install channel; see [delivery](../guides/delivery.md).

## Next stages

- **R29 — Measured reliability and observability:** establish repeatable discovery, structure, evidence and memory performance measurements; document budgets and cancellation; exercise interrupted writes, concurrent operations and recovery; provide bounded diagnostic summaries with actionable failure categories. Set targets from measured workloads rather than a global speed claim.
- **R30 — v1.0 acceptance:** freeze supported CLI/MCP/schema contracts; align clean-install, cross-directory, upgrade/rollback and core verification acceptance with the support matrix; document data compatibility and migration; publish a verified release with reproducible evidence and concise operating guidance.

## Expansion after the core release

Independent runtime bundles, build attestations/SBOM, richer language adapters, client-specific Skill discovery, behavior contracts and test associations are candidates for subsequent delivery. Team ownership rules, shared evidence, remote workers and queues depend on a concrete multi-user need. They are not implemented capabilities or prerequisites for the existing workflows.

Contributions should preserve existing CLI contracts and evidence integrity. Discuss substantial changes in a repository Issue before implementation.
