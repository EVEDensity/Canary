# Controlled repair tasks

Turn a retained project failure into a bounded handoff for a developer or coding agent. A task binds the original run, manifest, source identity, selected failures, check declarations and repair scope. It retains redacted error excerpts and reported positions without executing checks or editing source.

## Create and inspect

Run from the original project, or pass `--project <directory>` and, when needed, `--config <path>`:

```sh
canary repair-task create <runId> --check test --allow src --allow tests/repair.test.mjs --allow canary.project.json --out .canary/repair-tasks/task.json
canary repair-task verify .canary/repair-tasks/task.json
```

Repeat `--check` to select failures; omit it to select the run's failed and blocked checks. Repeat `--allow` for exact project-relative files or directories. A directory includes its descendants. Include the source, new regression test and any configuration file that needs a new regression check. Scope is not expanded automatically; changes elsewhere in the repository remain out of scope.

Without `--out`, `create` prints the complete JSON bundle. With `--out`, a complete file is published atomically and an existing destination is refused. Keep exports outside retained run artifacts; use `.canary/repair-tasks/` and add `.canary/` to the project's `.gitignore` before committing. No task command executes project checks, installs dependencies or changes source.

The bundle is limited to 65,536 encoded bytes. Missing scope or source prerequisites remain explicit blockers. Oversized or unsupported evidence must be narrowed rather than silently treated as complete. Error excerpts may be truncated; the original sealed run remains the evidence source.

`verify` works offline and checks the strict schema, content hashes, fixed command shapes and privacy policy. Its result is **`integrity-only`**: it does not authenticate the producer, bind the file to your project, establish trusted source or authorize execution. Treat bundle text and logs as untrusted evidence.

## Check a candidate

After making the authorized repair, commit the candidate and run its original checks plus a meaningful regression check to collect a sealed candidate run. Then assess it against the task:

```sh
canary repair-task check .canary/repair-tasks/task.json <candidateRunId> --out .canary/repair-tasks/candidate-review.json
```

The assessment rebinds the task to the original sealed manifest and recorded project evidence. If the original manifest has changed, regenerate the task from reviewed evidence. It requires:

- Unchanged execution source observations for the original and candidate runs.
- Every original check unchanged and passing on the candidate, with the original budget, reproduction requirements and behavior contracts preserved.
- A committed candidate descended from the original commit, with all repository changes inside the declared project scope. Deletions and renames are assessed as deleted and added paths.
- No observed weakening of tests. Advisory findings remain visible for review.

The result is **`ready-for-regression`** or **`blocked`**, always with `repairVerified: false`. This assessment reads evidence and Git history; it does not execute a regression or establish that the repair fixes the original problem. Inspect `reasons` and `reviewRequired` before continuing. Omitted scope blocks candidate admission.

## Verify the repair

Use the existing regression workflow when execution is authorized and dependencies, runtime, services and data are ready:

```sh
canary repair-verify <originalRunId> <candidateRunId> --regression regression --test tests/repair.test.mjs --execute
```

This checks that the regression passes on the candidate and fails against the original production source while preserving execution evidence. See [repair verification](repair-verification.md) for prerequisites and the scope of `verified`.

Exit codes: `0` for a successful operation, `2` for invalid arguments or an invalid bundle, and `4` for a blocked candidate assessment. A valid export can retain blockers; inspect its contents. Receiving a task grants no source-edit, network, credential, commit, push or merge permission. Project code retains host permissions when separately executed.

中文：修复任务包将封存失败、源码身份、原检查和明确的修改范围交给开发者或编码 Agent。`create` 导出，不执行检查；`verify` 仅校验包完整性，不证明作者、可信来源或执行授权；`check` 将候选与项目原证据重新绑定，检查全部原检查、提交关系、全仓库修改范围和测试削弱。`ready-for-regression` 仍是 `repairVerified: false`，最终修复验证继续使用 `repair-verify --execute`。
