# Checks and diagnosis

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
