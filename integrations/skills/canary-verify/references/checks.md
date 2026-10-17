# Checks and diagnosis

## Select the evidence that matches the task

Inspect the selected project's declarations and any existing Canary configuration. For a configured Agent, keep its adapter, case set, tools and provider. Pass its configuration explicitly when the project also has a `canary.project.json` file; automatic discovery may otherwise select project checks. Agent assessment uses:

```sh
canary run --ci --config <agent-config>
canary assess <runId> --config <agent-config> --json
canary host evidence <runId> --max-cases 8 --max-events 20 --config <agent-config>
```

`run` executes the configured Agent; `assess` and `host evidence` read retained evidence without a model call. Start with the shared brief and use bounded host evidence for matching details. Check provider/call conditions before execution; reuse a matching sealed run for analysis only. Do not guess a provider, consume credentials, enable a Judge or repeat live calls without authorization. If no Agent adapter/cases exist, offer a concrete adapter/case draft for review. Project checks establish project health, not Agent behavior.

## Project checks

Run the project's existing check plan:

```sh
canary run --ci
canary run --ci --project <directory>
canary run --ci --config <path>
```

`--ci` produces a machine-readable result and avoids starting the interactive report server. Save the run ID, result status, exit code and artifact location. Automatic discovery uses existing project declarations; inspect a supplied executable configuration and unfamiliar check commands before running them. Do not create a configuration, install dependencies or contact services merely to make discovery pass unless the task already authorizes that work.

For retained evidence, run from the original project:

```sh
canary verify <runId> --json
canary assess <runId> --json
canary diagnostics <runId>
```

`diagnostics` is the CLI command name. It reports check IDs, recorded commands, redacted failure output, source positions and missing context. Source positions are reported evidence; verify them against the matching source version before editing. Dependency explanations can be hypotheses, and absent metadata remains unknown.

If the user needs a portable diagnostic bundle, choose a new output path:

```sh
canary diagnostics <runId> --out <new-bundle.json>
canary diagnostics verify <bundle.json>
```

Export requires sealed, verified evidence and refuses an existing output file. Hash checks detect changes or corruption; they do not authenticate the producer. Keep secrets out of commands, reports and summaries. Report what was actually observed and which check or prerequisite prevented completion.

## Form a quality brief and a decision

Start with `assess`: CLI, MCP and workspace share the same report from sealed evidence, options and decision revision. Explain its rule-derived recommendations, evidence and uncertainty; retain `omittedIssues`, `omittedHistory` and `omittedDecisions`. Current, non-stale choices carry forward without asking the same question again. Recommendations are not confirmed root causes or measured benefits.

Use `selections` for the current direction of each issue, independently of the bounded history. A newer selection replaces the prior one for that issue; rejecting its current option clears the selection.

For Agent detail, bounded `host evidence` includes assertion IDs/messages, case/execution identities, latency, steps and tool calls. Trace types are summaries, not raw arguments or output. Read only the matching redacted trajectory/source when needed; do not infer arguments from event names or fill historical gaps with current files. Project failures use `diagnostics`; inspect child Agent runs in their recorded configuration.

Distinguish task/output correctness, tool selection/arguments/order, state/termination, environment failures, performance observations and missing tests/coverage. Include available counts and their scope. Missing token/cost telemetry is unknown, not zero. A tool/trace symptom alone is not proof that a prompt, model or function caused it.

For each important issue, give the evidence, impact, likely explanation with uncertainty, and a useful next action. Where alternatives exist, offer the recommended action and its rationale, a lower-change investigation, or a contract/test review when the intended behavior is ambiguous. State changed scope, expected outcome, necessary validation, and known resource cost; then follow the user's selection or already authorized plan. Do not automatically relax assertions, increase budgets or replace the model to obtain a green run.

The host can explain evidence and propose choices without writing Canary state. `canary improve` writes regression drafts, and `canary suggest` writes suggestion records even without decision flags. Use either only when writing those outputs is part of the task; neither is a read-only preview, nor does its `verified` suggestion label prove an executed fix.

When the task explicitly requires storing a choice, use the current report's `contentHash`, view `revision` and matching option ID:

```sh
canary assess decide <runId> --report-hash <hash> --expected-revision <revision> --option <optionId> --action select --actor <actor> --reason "<reason>" --json
```

Use `--action reject` for rejection and the same `--config` or `--project` binding as the read. A choice grants no execution or approval; actor is audit metadata, not authenticated identity. Stale evidence/revision, corrupt records or unknown options reject writes. Records are separate from the sealed run under `<artifactRoot>/.quality`; a manifest change marks prior choices stale. The view is bounded to 64 KiB and up to the latest 16 choices with omission counts. Do not write a choice for every conversation or bypass a storage limit.
