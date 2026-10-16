# Verify a requested repair or change

Use the requested task's authorization for any source or test edits. This Skill does not authorize editing code merely because a check failed. Preserve retained baseline evidence and the original check definitions.

When the repair came through a task bundle, follow [repair handoff](references/handoff.md) to check the sealed candidate against its original identity and declared scope first. `ready-for-regression` is candidate admission with `repairVerified: false`; it does not replace the regression execution below.

For an authorized repair, add a meaningful regression test within the repair's scope, rerun the original checks, and collect a sealed candidate run. Inspect the repair assessment:

```sh
canary repair-verify <baselineRunId> <candidateRunId> --regression <checkId> --test <test.spec.mjs>
```

The regression check must explicitly execute the supplied test file and pass on the candidate. Repeat `--regression` or `--test` for genuinely required checks/files. With no execution flag the command assesses retained evidence; it does not prove that the new assertion fails on the baseline.

When reproduction of that test on the original source is authorized, use:

```sh
canary repair-verify <baselineRunId> <candidateRunId> --regression <checkId> --test <test.spec.mjs> --execute
```

This prepares separate source checkouts and executes project code. Dependencies, environment, services and data still need the prerequisites described by the command. Keep a blocked or `evidence-insufficient` assessment visible; do not weaken checks, fabricate output or claim success from a passing candidate alone. `verified` is scoped to the selected regression files and retained original checks.

For changes against a user-selected Git baseline:

```sh
canary run --ci --base <commit-or-ref>
canary change-verify <runId> --base <commit-or-ref>
canary change-verify <runId> --base <commit-or-ref> --summary
```

`run --base` seals change analysis after the checks; `change-verify` analyzes an existing run against an ancestor baseline. `--summary` returns a bounded acknowledgement with up to 12 gaps, while the full report remains sealed in the run artifacts. Both paths read historical Git objects and retain source/configuration/execution identity; current worktree files cannot substitute for historical source. Legacy records without tracked-input commit proof and changed source remain unknown.

Report execution numerators/denominators and unknown-file counts separately for lines, functions and branches. Explicit behavior counts refer to files with maintainer-declared assertions, not inferred correctness. Keep observed failures and uncovered paths distinct; incomplete measurements do not become zero coverage. Ordinary gaps do not alter check exit codes. Only explicitly required project behavior contracts affect CI gates; an analysis that cannot complete remains unavailable.

Summarize the run IDs, chosen baseline, concrete observations and remaining limits. Committing, publishing and merging follow the user's existing instructions and are separate from gathering verification evidence.
