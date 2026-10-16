# Reproduce a retained failure

Start with a preview in the original project's context:

```sh
canary reproduce <runId> --check <checkId>
```

The preview runs no checks and creates no workspace. Read its recorded source/runtime and prerequisites. Clean, sealed, version-bound source evidence and readable Git objects are required; dirty or legacy runs can remain blocked. Preview alone is not a reproduced failure.

When local preparation is within the current task, create a separate checkout:

```sh
canary reproduce <runId> --check <checkId> --prepare
```

Use the returned workspace ID and path. Canary does not install dependencies automatically. Prepare them with the project's locked workflow only when already authorized; network access and services retain their own scope.

When execution of the recorded project code is authorized, run:

```sh
canary reproduce <runId> --check <checkId> --execute --workspace <workspaceId>
```

Use `--project <directory>` or `--config <path>` to locate original evidence when needed. Pass only required environment names with `--env <NAME>`; provide their values through the user's terminal or secret manager. `--ack-service <name>` and `--ack-data <name>` mean the named prerequisite has actually been prepared, not that Canary provisions or verifies it. Do not invent acknowledgements to bypass a block. HTTP and Docker checks can also require their reported service acknowledgements.

Preserve the child run ID and verify it with `canary verify <childRunId> --json`. `reproduced` means the retained failure matched on unchanged restored source; it does not prove a root cause. `failure-observed`, `not-reproduced`, `blocked` and `source-changed` have different meanings. A successfully reproduced failing check still returns a nonzero check exit code. Separate checkouts and private homes do not provide operating system isolation.
