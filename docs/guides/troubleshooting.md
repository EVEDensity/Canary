# Troubleshooting

## Checks are not discovered

Run `canary paths --json` and `canary doctor --json`. Confirm the target project, declared scripts and installed dependencies. Use `--project <directory>` or an explicit `--config` to select the intended project. Existing configuration takes priority over automatic discovery.

## The report does not connect

Check the address printed by the CLI and keep the report process running. Ensure the selected port is available. `--ci` and `--headless` do not start the report server.

## Coverage is unavailable

Confirm that a supported collector ran and its source identity matches the recorded version. Remote execution and missing measurements are unavailable, not measured zero coverage.

## Checks pass but the run fails

Inspect the failed checks, assertions and gate report. Preserve the original evidence before rerunning. A partial rerun does not verify checks outside its scope.

## An interrupted run remains incomplete

Inspect the checkpoint and integrity state. Recovery preserves completed results; incomplete or damaged evidence must not be reported as a successful run.

## A service adapter is incompatible

Check the request format, tool name and supported transport. Adapter success does not imply compatibility with every service implementation.

When reporting an Issue, include the version, command, expected result and a redacted reproduction. See [security policy](../../SECURITY.md).
