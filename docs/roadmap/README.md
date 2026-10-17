# Product roadmap

Canary connects Agent evaluation, guided improvement, project checks, architecture, coverage and failure evidence. Distribution uses GitHub source and Releases.

R16–R30 have implemented workflows within the documented support boundaries.

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

- **R29 — Agent quality briefs and guided decisions:** CLI, MCP and workspace share bounded, version-bound briefs from sealed Agent assertions, project failures, coverage gaps and linked history. Rule-derived recommendations retain evidence, uncertainty, scope, prerequisites and validation plans. Explicit selection/rejection binds actor, reason, report hash and revision without granting execution or approval; stale and corrupt records are rejected. See [the workflow](../guides/agent-workflow.md).

- **[R30 — Controlled improvement and measured benefit](https://github.com/EVEDensity/Canary/issues/25):** implemented `improvement prepare/execute/show` for reviewed function-Agent candidates with sealed baseline/selection identities, all original deterministic contracts, independent regression/holdout, durable attempt claims and cumulative budgets. CLI, MCP and workspace expose bounded paired changes, uncertainty and available telemetry. Managed live calls are disabled; arbitrary project network activity is not metered. Source edits remain host work and experience activation uses the existing reviewed controls. See [the workflow](../guides/agent-workflow.md).

## Next stages

The official Skill explains the shared quality brief through a compatible host. R29 records recommended options and explicit choices; R30 connects eligible selected Agent options to frozen, explicitly authorized candidate verification and paired benefit.

- **R31 — Measured reliability and observability:** measure discovery, structure, evidence and memory overhead; document budgets and cancellation; exercise interrupted writes, concurrent operations and recovery; provide actionable stage diagnostics and controlled storage/version retention. Prefer short, repeatable fixtures and set targets from measured workloads.
- **R32 — v1.0 acceptance:** freeze supported CLI/MCP/schema contracts; align clean-install, cross-directory, upgrade/rollback and the Agent assessment-to-verified-improvement workflow with the support matrix; document compatibility and migration; publish reproducible evidence and concise operating guidance.

Reliability and stable-release acceptance remain required engineering work, now tracked under R31 and R32 while the next product milestones focus on Agent assessment and improvement.

## Expansion after the core release

Independent runtime bundles, build attestations/SBOM, richer language adapters, client-specific Skill discovery, behavior contracts and test associations are candidates for subsequent delivery. Team ownership rules, shared evidence, remote workers and queues depend on a concrete multi-user need. They are not implemented capabilities or prerequisites for the existing workflows.

Contributions should preserve existing CLI contracts and evidence integrity. Discuss substantial changes in a repository Issue before implementation.
