# Failure reproduction

Restore a sealed project failure in a separate checkout and rerun its recorded check with fresh prerequisites. Source versions, execution evidence and parent-run identity stay connected.

## Workflow

```bash
canary reproduce <runId> --check <checkId>                 # Preview recorded conditions
canary reproduce <runId> --check <checkId> --prepare       # Create an independent checkout
canary reproduce <runId> --check <checkId> --execute       # Authorize preparation and execution
```

Use `--project <directory>` or `--config <path>` to locate the original evidence. Preview runs no project commands and creates no workspace. `--prepare` returns a workspace ID and project path without executing checks.

Prepare dependencies in the returned directory using the project's locked installation workflow, then reuse the workspace:

```bash
canary reproduce <runId> --check <checkId> --execute --workspace <workspaceId>
canary verify <newRunId> --json
```

Canary fetches only the recorded commit into `.canary/reproductions/`; it does not stash, reset or check out the caller's worktree. The restored source inventory must match the sealed original. Uncommitted source from the original run cannot be reconstructed from a commit and remains blocked.

## Explicit conditions

Project configurations can declare required environment, external services and data:

```json
{
  "kind": "canary.project",
  "version": 1,
  "reproduction": {
    "requiredEnvironment": ["TEST_ENDPOINT"],
    "services": ["test-database"],
    "data": ["test-seed"]
  },
  "checks": [
    {
      "id": "integration",
      "type": "command",
      "command": "node",
      "args": ["integration.mjs"],
      "envAllowlist": ["TEST_ENDPOINT"]
    }
  ]
}
```

Supply environment values through your terminal or secret manager, then forward names explicitly:

```bash
canary reproduce <runId> --check integration --execute \
  --env TEST_ENDPOINT --ack-service test-database --ack-data test-seed
```

Acknowledgements declare that you have prepared those conditions; they do not provision or verify external services and data. HTTP and Docker checks also require acknowledgement of `http:<checkId>` or `docker:<checkId>`.

Unrelated environment variables, credential files and user package-manager configuration are not inherited. Execution uses a private home directory. Dependency installation is a separate, explicit operation; Canary does not install packages or reuse the caller's dependency directory automatically.

## Results and evidence

- **`reproduced`**: the same failed check, exit and normalized error were observed on unchanged restored source. This does not confirm a root cause.
- **`failure-observed`**: a check failed, but the retained error could not be matched reliably.
- **`not-reproduced`**: the selected check executed and passed.
- **`blocked`**: conditions were incomplete or the check could not execute.
- **`source-changed`**: execution changed the tracked source or commit; it cannot establish a reproduction of the original version.

Each execution attempt records `reproduction.json` alongside its check logs, exit codes and manifest. Lineage includes `replayOf` and the original manifest hash. Blocked attempts record `executed: false`. Check failures retain a nonzero exit code even when successfully reproduced.

The current workflow requires recorded clean-source metadata and the same Canary and Node versions, operating system and architecture. Automatic script dispatch also checks its recorded content hash. It supports portable project checks; Agent checks, private tracked configuration, submodules, source symlinks and nonportable interpreter paths require separate preparation. Node, Git and Canary versions are recorded; other tools must be prepared according to the recorded command and project declarations. Legacy runs missing required metadata remain blocked.

A separate checkout is not an OS sandbox. `--execute` authorizes recorded project code and its dependencies; run untrusted projects in an isolated runner or container. Hashes detect changed evidence, not its authorship.

## 中文说明

使用 `canary reproduce <runId> --check <checkId>` 预览条件；添加 `--prepare` 创建独立副本，添加 `--execute` 明确授权执行。准备好依赖后，通过 `--workspace` 复用副本。原目录及未提交修改不会被恢复操作改写。

必需环境变量只通过 `--env <名称>` 显式传递，服务与数据通过 `--ack-service`、`--ack-data` 确认已准备。缺少条件返回 `blocked`，不把未执行当作复现成功。复现日志、退出码、源码版本和原失败关联进入可校验的证据链。
