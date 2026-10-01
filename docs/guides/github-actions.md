# GitHub Actions

Run project checks with commit-bound summaries, source annotations and downloadable diagnostic evidence. The integration requires only `contents: read` and does not create PR comments.

## Workflow

Prepare your project dependencies and services before invoking Canary. For a Node project:

```yaml
name: Canary
on: [push, pull_request]
permissions:
  contents: read
jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha || github.sha }}
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - uses: EVEDensity/Canary/.github/actions/verify@main
        with:
          project: .
```

Use your project's dependency command instead of `npm ci` when appropriate. Pin the action to a reviewed commit for production workflows. This action becomes available on `main` after the R17 branch is merged.

Inputs: `project` selects a directory inside the checkout; optional `config` selects a configuration file relative to that directory. `artifact-name` gives each invocation a unique download name when using the action multiple times in one job.

## Results

- **Passed / failed / blocked:** reflect the checks and their execution requirements.
- **Evidence insufficient:** successful checks without verified, version-bound evidence cannot produce a verified pass.
- **Stale:** an unexpected commit or changed tracked source cannot validate the requested version.

The job summary links to the workflow, report downloads and verified source positions. Reports include `summary.md`, `github-report.json` and, when available, the sealed diagnostic bundle. Failed checks preserve their exit code after evidence upload.

Annotations require an unchanged checkout, matching evidence commit, a tracked repository file and a valid source line. Unknown or external locations remain in diagnostics without guessed annotations. A reported stack position is evidence of where an error was observed, not proof of its root cause.

Each workflow retains its own commit-bound summary. Reruns do not create duplicate comments or replace another run's results. The structured outputs are `outcome`, `run-id` and `exit-code`.

## Fork PRs

Use `pull_request` with read-only permissions. Do not use `pull_request_target` to execute untrusted PR code, inject secrets into fork checks, or combine verification with deployment. Project checks execute repository code; use an isolated hosted runner for untrusted contributions. Publishing and deployment remain separate workflows restricted to `main`.

## 中文说明

在准备好项目依赖和服务后，调用上面的 Action，即可获得绑定提交版本的检查摘要、源码标注和证据下载。无需 PR 写权限，也不会创建重复评论。

`project` 指定项目目录，`config` 可选；同一任务多次调用时，通过 `artifact-name` 区分报告。失败和阻塞会保留退出码，版本不匹配标为过期，证据不足不会判定为已验证通过。只有版本一致、源码未改变且位置可靠时才生成源码标注。

Fork PR 使用只读的 `pull_request` 流程，不注入密钥；发布和部署保持独立，仅允许 `main` 执行。
