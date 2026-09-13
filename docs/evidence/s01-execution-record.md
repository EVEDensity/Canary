# S-01 Execution Record

## Baseline and environment

- Baseline commit: `01c22c357985eaaf08edadc86c7efe85730cfb92` (`build: install-global script`)
- Date: 2026-09-13
- Host: Codex desktop `26.727.4816.0` / Windows
- Node: `v24.18.0`
- pnpm: `10.15.0`
- Working protocol: `docs/roadmap/00-working-protocol.md`

## Goal

Complete the minimum Canary Skill loop in one explicitly identified Codex desktop host: project discovery -> evaluation -> bounded evidence read -> structured review proposal -> Canary validation. The CLI must remain usable without a host model.

## Non-goals

This task does not implement an MCP Server, automatic source writes, a sandbox, unlimited background tasks, automatic model/token calls, automatic approval/publication, a host-wide `/canary` command, versioned experience loading, or H-series isolation. `recorded_unapproved`, `verified`, and `accepted` must not be interpreted as release permission.

## Changed paths

- `packages/cli/src/host.ts`: versioned host protocol, bounded evidence, proposal validation, and unapproved recording.
- `packages/cli/src/index.ts`: `run --json`, `host discover`, `host evidence`, and `host validate-proposal`.
- `packages/cli/src/app.ts`: suppress ordinary reporter output in JSON mode so stdout remains one structured object.
- `packages/cli/tests/cli.e2e.test.ts`: structured output, evidence bounds, successful proposal, and malformed proposal rejection tests.
- `integrations/codex-desktop-26.727.4816.0/SKILL.md`: fixed host workflow and safety boundaries.
- `integrations/codex-desktop-26.727.4816.0/agents/openai.yaml`: Skill UI metadata.
- `docs/evidence/s01-codex-desktop-26.727.4816.0.md`: real host success/rejection evidence.
- `docs/evidence/s01-execution-record.md`: this execution record.
- `docs/roadmap/README.md`: S-01 status updated to implemented.

## Behavior changes

`canary run --headless --no-open --json` emits `canary.host.run` with `runId`, artifact paths, and exit code. `host evidence` returns at most 8 cases by default and at most 16 event types per case, and marks the response with `untrustedEvidence=true`. Proposals must reference an existing run and case. Successful validation records `recorded_unapproved`; invalid proposals return `rejected` and a nonzero exit code.

## Acceptance results

- Successful flow: passed. Run `run_cb994683-ddd6-4d45-916f-a14402b1fbdc` completed all 15 default cases successfully.
- Rejection flow: passed. A malformed proposal returned `rejected`, exit code 1, and `approval.status=not_approved`.
- CLI without a host model: passed; the default deterministic configuration made no external model call.
- Private credential access: not performed; the Skill explicitly forbids it.
- Host interruption: the Skill requires an honest stopped/interrupted report and does not permit pretending that execution continued.

## Test results

- CLI unit/end-to-end tests: 26 passed.
- `pnpm build`: passed (exit 0).
- `pnpm test`: passed (exit 0).
- `pnpm typecheck`: passed (exit 0).
- `pnpm lint`: passed (exit 0).
- `pnpm demo:headless`: passed, 15/15 cases and 45/45 assertions (exit 0).
- `pnpm format:check`: initially failed because the newly added evidence files were not formatted; Prettier was run and the final check passed (exit 0). This was a task-local documentation formatting issue and is fixed.

## Validation logs

- `docs/evidence/logs/s01-pnpm-build.txt`
- `docs/evidence/logs/s01-pnpm-test.txt`
- `docs/evidence/logs/s01-pnpm-typecheck.txt`
- `docs/evidence/logs/s01-pnpm-lint.txt`
- `docs/evidence/logs/s01-pnpm-demo-headless.txt`
- `docs/evidence/logs/s01-pnpm-format-check.txt` (initial check; final check passed after formatting)
- `docs/evidence/s01-validation-results.json`

## Uncovered boundaries

Other Codex versions, other hosts, MCP Server interoperability, sandbox security, internal prompts/traces of remote black-box Agents, independent semantic Judge quality evidence, and automatic activation/publication were not covered. These remain pending in the roadmap.

## Rollback

Revert the task-local code, tests, Skill, and evidence documents, or delete/uninstall `integrations/codex-desktop-26.727.4816.0/`. This rollback does not delete existing run artifacts or require restoring user history.

## Related documents

- `docs/roadmap/00-working-protocol.md`
- `docs/roadmap/03-host-and-soft-evolution.md#s-01`
- `docs/evidence/s01-codex-desktop-26.727.4816.0.md`
