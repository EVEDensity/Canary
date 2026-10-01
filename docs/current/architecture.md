# Architecture

Canary is a pnpm workspace with a CLI, an interactive report application and shared verification modules.

## Execution flow

1. The CLI resolves the project and its explicit configuration or discovered checks.
2. The runner executes checks and records results, logs and source identity.
3. Coverage and structure modules associate measurements with the matching code version.
4. The trace module persists artifacts, content hashes, manifests and run lineage.
5. Reporters and the verification workspace expose the same recorded results.
6. Reruns preserve the original failure and create a linked verification record.

## Modules

- `packages/core`: configuration, schemas and shared contracts.
- `packages/cli` and `packages/runner`: commands, execution and lifecycle management.
- `packages/structure` and `packages/coverage`: structure, dependencies, changes and coverage.
- `packages/trace` and `packages/reporters`: evidence storage and report formats.
- `packages/adapters` and `packages/environment`: application and tool integration.
- `packages/improvement` and `packages/experience`: issue handling and reviewed experience.
- `apps/web`: report APIs, live updates and interactive views.
- `apps/site`: bilingual product website.

## Data and execution boundaries

Artifacts belong to the target project's `.canary/` directory. Historical views use sealed structure snapshots. Source content is checked against its recorded identity before mapping evidence.

Commands and configuration modules execute with the host's permissions. Process isolation is not an operating-system security sandbox. Remote adapters expose only the evidence they provide; unavailable coverage remains unavailable.

See [configuration](../guides/r4-project-checks.md), [evidence integrity](../guides/r3-artifact-evidence.md) and [security policy](../../SECURITY.md).
