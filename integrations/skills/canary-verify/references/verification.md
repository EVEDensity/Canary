# Verify a requested repair or change

## Agent behavior improvements

Keep the original Agent run, case IDs, inputs, assertions, tool setup and independent holdout fixed. For an actionable option selected in the shared quality brief, prepare the candidate entry within the user's authorized source scope, then use the bounded workflow:

```sh
canary improvement prepare <baselineRunId> --option <optionId> --report-hash <hash> --expected-revision <revision> --entry candidate.mjs --allow candidate.mjs --allow tools.mjs --regression <failedCase> --holdout <passingCase> --max-runs 1 --max-cases 8 --max-ms 60000 --max-tool-calls 32 --config <agent-config> --json
canary improvement execute <sessionId> --plan-hash <planHash> --actor <actor> --reason "<reason>" --execute --config <agent-config> --json
canary improvement show <sessionId> --config <agent-config> --json
```

Use the actual selected option/hash/revision and task budgets, not the example numbers. The flow requires a retained selection; record one with `assess decide` only as part of the user's requested execution workflow, using caller-declared attribution rather than invented human approval. Inspection or contract-review choices do not authorize candidate execution.

Preparation is inert and freezes all original cases/repetitions, candidate entry/configuration, allowed files and recognized source inventory. Include every failed case in regression and independent, previously passing holdout cases; repeat flags for multiple files/cases. Include the configured mock-tool entry in `--allow`. Execution needs the exact plan hash and explicit request, consumes a durable attempt before configuration loading, and retains a sealed candidate plus paired benefit. Budgets are cumulative across explicit attempts of that frozen candidate. Stop on source/selection drift, exhausted budget, interruption or a stopped attempt; inspect before preparing a new plan. Never silently retry, widen scope or relax a contract to clear the result.

This executor supports function Agents, mock tools and serializable deterministic contracts without loaded experience; managed live calls are disabled. Tool calls are counted before invocation and tool assertions use actual managed calls, with bounded JSON arguments up to 64 KiB. It is trusted project execution, not an OS sandbox or a meter for arbitrary SDK/network calls. Unknown tokens/cost remain unknown. Fewer than five pairs, missing evidence, uncalibrated Judge scores or regressions cannot establish successful observed benefit. Explain changes as fixed-contract observations, not causal or general improvement.

For HTTP/MCP or another unsupported contract, use the existing reviewed `candidate`/`compare` workflow within the task's explicit call budget. Preserve its weaker evidence boundaries; do not convert it into an R30 success. Project regression receipts remain separate from Agent comparisons.

For slow analysis, `canary profile <runId> --samples 3 --json` measures discovery, structure, evidence, the quality brief and memory lookup without importing configuration or executing checks. Report each stage's measured scope and unavailable reasons; sequential samples are not a production latency guarantee.

For an evidence quota or maintenance request, preview `canary archive create <directory> --json`. Offer copy to preserve the active collection, or `--rotate` to archive the full collection and free its record quota. Apply requires the same mode, exact plan hash, actor/reason and authorization for that maintenance action. Preserve linked baseline/candidate runs together. Restore only into the original empty artifact location; never replace populated evidence or automatically rebind project identities. `archive recover` previews collection operation locks; only an explicitly reviewed apply may release unchanged dead-owner locks. Never rotate evidence solely to hide a failure or retry a consumed improvement attempt.

After an interrupted attempt, inspect `canary improvement recover <sessionId> --json`. Recovery is a separate state change: when authorized, apply only its exact `sessionHash` and `lockHash` with `--apply --session-hash <hash> --lock-hash <hash|absent> --actor <actor> --reason "<reason>"`. Live or unproven ownership blocks recovery. Never remove a lock or signal a persisted PID to bypass that result. Recovery closes a dead-owner ledger without rerunning work, restoring budget or inventing missing counters. A leftover recovery guard requires inspection; it is not automatically stolen. Continue only with a newly reviewed plan and the task's remaining authorization.

Retaining an improvement as experience requires its existing proposed/validation/regression/holdout/review flow. Preparing or validating a soft trial may execute additional Agent calls; do not activate experience or export/install a draft from a verbal choice alone. Follow the project's reviewed experience guide and current control revision for those actions. Function-context delivery, Agent use and measured benefit remain separate facts; HTTP/MCP adapters do not inject that experience context.

## Project repair and change evidence

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

When the task explicitly requests retaining reviewed repair facts, use `canary memory record <candidateRunId> --actor <operator> --reason <reason>` after a verified regression. Require the user's operator identity/reason and any advisory review; do not invent approval or add `--ack-review` to bypass it. Retrieval through `canary memory query` or MCP `canary.memory` is read-only history, not current repair proof, automatic context delivery or execution permission. Recording and revocation are explicit CLI operations.
