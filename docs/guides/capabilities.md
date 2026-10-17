# Capabilities

Canary connects Agent evaluation, guided decisions, project checks, architecture and verifiable improvement evidence. Use the CLI in a project or subdirectory, the interactive workspace for investigation, and GitHub Actions or MCP for integration.

## Run existing checks

- **Automatic discovery:** declared Node build, type-check, lint, format and test scripts; workspace packages; standard Python, Go and Rust test commands. No Canary configuration is required when supported checks already exist.
- **Custom plans:** command, process, HTTP, filesystem, Docker, resource and Agent checks with required/optional status, dependencies, working directories, platform rules, timeouts and explicit environment requirements.
- **CI and reports:** stable exit codes, headless execution, JSON/JUnit/Markdown reports, retained run history and linked reruns. Project dependencies and services use the project's prepared environment.

See [automatic checks](automatic-checks.md), [configuration](r4-project-checks.md) and [CLI](cli.md).

## Understand the project and its changes

- **Structure:** workspaces, packages, directories, files and available symbols; source positions, stable identities, import/package relationships and Git changes.
- **Interactive maps:** 2D and layered 3D, tree navigation, search, dependency filters, selected-module upstream/downstream focus and historical source details.
- **Architecture analysis:** dependency cycles, declared layer restrictions and impact paths. Explicit affected-check selection falls back conservatively when its dependency or scope evidence is incomplete.
- **Coverage:** collected file, line, statement, function and branch denominators; uncovered paths and source highlighting. Missing or mismatched measurements stay unknown.
- **Change verification:** changed execution coverage, explicit behavior assertions, check scope and classified verification gaps, bound to the run's code version.

JavaScript/TypeScript have the detailed static map workflow. Other languages expose available structure through the current adapters. Executed code does not by itself establish correct behavior, and uncovered code is a verification gap rather than an observed failure.

See [maps](architecture-map.md), [structure](project-structure.md), [architecture CI](architecture-ci.md) and [change verification](change-verification.md).

## Diagnose and verify a repair

- **Issues and evidence:** categorized failures, reported source positions, assertions, redacted execution output and environment requirements, with bounded exportable evidence bundles.
- **Reproduction:** preview, prepare an independent source checkout, then explicitly execute when the required runtime, dependencies, environment, services and data are ready.
- **Repair handoff:** export a sealed task with original checks and an explicit repair scope; inspect a candidate without weakening the original verification conditions.
- **Regression verification:** retain a test that passes after the fix and fails against the original production source, alongside the original checks and three bound run identities.
- **Project memory:** explicitly record verified repair facts with an operator, reason, expiry and revocation; retrieve related history with source/environment revalidation and context budgets.

Candidate admission, a passing check, historical similarity and executed repair verification are separate results. Canary reports unavailable or insufficient evidence where these conditions cannot be established.

See [diagnosis](failure-diagnostics.md), [reproduction](reproduction.md), [repair tasks](repair-tasks.md), [repair verification](repair-verification.md) and [project memory](project-memory.md).

## Work with agents

- **Official Skill:** project installation, ownership hashes, updates, conflict preservation, rollback, removal and a downloadable Release ZIP.
- **Shared quality brief:** read-only `assess` combines sealed Agent assertions, project failures, coverage gaps and linked history. CLI, MCP and workspace share rule-derived recommendations, evidence, uncertainty, scope and available counts; unknown costs stay unknown.
- **Guided decisions:** the Skill explains recommendations and carries forward existing choices. Explicit CLI/workspace selection or rejection records actor, reason, report hash and revision separately from execution or approval. Changed evidence marks earlier choices stale.
- **Controlled improvement:** fixed-contract function-Agent candidate verification with selected directions, hashed plans, original cases, regression/holdout, explicit execution and cumulative budgets. Paired observations retain regressions, sample limits and unknown cost; CLI, MCP and workspace expose execution history. See [the workflow](agent-workflow.md).
- **Project-bound MCP:** bounded evidence and assessment queries, startup opt-in decision recording, and explicit check, reproduction, repair and change-verification operations.
- **Application evaluation:** function, HTTP and MCP adapters; deterministic output, tool, state, event, termination, latency and budget assertions; fixed cases, repetitions and comparisons.
- **Reviewed experience:** traceable candidates, scoped context selection, baseline/regression/holdout trials, human decisions, activation, exact rollback and Skill drafts. Selection, delivery, use and measured benefit remain distinct.
- **Control:** explicit actions with actor/reason, revision checks, idempotency and audit records for the supported workflows.

Ordinary project checking, static analysis, reports, memory lookup and Skill installation do not invoke a model. Project code or explicitly configured Agent/Judge operations may use a model. A Skill or MCP connection grants no additional source, network or merge permission.

See [Skill](skills.md), [MCP](mcp.md), [evaluation](evaluation-and-coverage.md), [experience](r8-project-experience.md) and [control](l02-control-plane.md).

## Evidence, interface and delivery

- **Evidence integrity:** manifests, content hashes, run lineage, retained source/execution identities, JSONL traces and explicit partial/corrupt states.
- **Privacy and maintenance:** redaction on persistence and output paths, bounded export, preview/apply retention and centralized test logs.
- **Bilingual workspace:** English/Chinese overview, structure, checks, coverage, cases, evidence, issues and history; trends, filters and source/evidence navigation.
- **GitHub integration:** commit-bound summaries and optional source annotations, downloadable evidence, preserved check exit codes and restricted publication from `main`.
- **Delivery:** published stable source selection, update checks, version pinning, independent upgrades, runtime inventories and verified rollback.

See [evidence](r3-artifact-evidence.md), [workspace](unified-workspace.md), [GitHub](github-actions.md), [delivery](delivery.md) and [support scope](support-matrix.md). Planned work is tracked separately in the [roadmap](../roadmap/README.md).

中文：现有能力覆盖项目检查、架构与变更、覆盖率、问题诊断、复现、受控修复交接、回归验证、项目修复记忆、Skill/MCP、Agent 评估、经验治理、双语界面和证据交付。各工作流按实际采集的数据给出结论；使用条件和后续计划分别记录。
