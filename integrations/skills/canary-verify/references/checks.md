# Checks and diagnosis

## Select the evidence that matches the task

Inspect the selected project's declarations and any existing Canary configuration. For a configured Agent, keep its adapter, case set, tools and provider. Pass its configuration explicitly when the project also has a `canary.project.json` file; automatic discovery may otherwise select project checks. Agent assessment uses:

```sh
canary run --ci --config <agent-config>
canary host evidence <runId> --max-cases 8 --max-events 20 --config <agent-config>
```

`run` executes the configured Agent; `host evidence` only reads retained evidence. Check provider/call conditions before execution; reuse a matching sealed run if the task requests analysis only. Do not guess a provider, consume credentials, enable a Judge or repeat live calls without the task's authorization. If no Agent adapter/cases exist, explain the missing setup and offer a concrete adapter/case draft for review. Existing project checks can still establish project health, but not Agent behavior.

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

For Agent cases, start with the bounded `host evidence` result: failed assertion IDs/messages, case/execution identities, latency, steps, tool calls and available budget metrics. Its trace types are a summary, not raw arguments or output. Read only the matching redacted trajectory/source or report when those details are needed; do not infer unseen arguments from event names. Project failures use `diagnostics`; a child Agent run should be inspected in its own recorded configuration.

Distinguish task/output correctness, tool selection/arguments/order, state/termination, environment failures, performance observations and missing tests/coverage. Include available counts and their scope. Missing token/cost telemetry is unknown, not zero. A tool/trace symptom alone is not proof that a prompt, model or function caused it.

For each important issue, give the evidence, impact, likely explanation with uncertainty, and a useful next action. Where alternatives exist, offer the recommended action and its rationale, a lower-change investigation, or a contract/test review when the intended behavior is ambiguous. State changed scope, expected outcome, necessary validation, and known resource cost; then follow the user's selection or already authorized plan. Do not automatically relax assertions, increase budgets or replace the model to obtain a green run.

The host can explain evidence and propose choices without writing Canary state. `canary improve` writes regression drafts, and `canary suggest` writes suggestion records even without decision flags. Use either only when writing those outputs is part of the task; neither is a read-only preview, nor does its `verified` suggestion label prove an executed fix.
