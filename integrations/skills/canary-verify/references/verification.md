# Verify a requested repair or change

Use the requested task's authorization for any source or test edits. This Skill does not authorize editing code merely because a check failed. Preserve retained baseline evidence and the original check definitions.

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
canary change-verify <runId> --base <commit-or-ref>
```

This requires sealed, clean, version-bound run evidence and readable historical Git objects. It writes a change-verification artifact associated with the retained run; it does not use the current worktree as a substitute for historical source. Keep changed-code execution coverage, observed failures and declared behavior assertions distinct. Missing or approximate coverage and undeclared behavior remain unknown. Only explicitly required project behavior contracts affect CI gates.

Summarize the run IDs, chosen baseline, concrete observations and remaining limits. Committing, publishing and merging follow the user's existing instructions and are separate from gathering verification evidence.
