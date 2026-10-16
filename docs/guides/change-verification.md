# Change verification

```bash
canary run --ci --base main
canary run --port 4318 --no-open --base main
canary change-verify <runId> --base <commit-or-ref>
canary change-verify <runId> --base <commit-or-ref> --summary
```

`run --base` analyzes changes after the project checks complete and seals `change-verification.json` with the run. `change-verify` analyzes an existing run against a resolved ancestor baseline. `--summary` returns a bounded acknowledgement with up to 12 gaps; the complete report remains in `.canary/artifacts/<runId>/change-verification.json`.

## Read the result

- **Execution coverage:** changed lines, functions and branches each retain their numerator, denominator and independent unknown-file count. Compatible measurements of the same source are combined by execution identity, without counting overlapping paths twice. Conflicting or approximate mappings remain unknown.
- **Explicit behavior:** verified, failed and unknown counts represent files with maintainer-declared assertions. Executed code alone does not establish behavior verification.
- **Verification gaps:** uncovered paths, missing measurements, undeclared behavior, failed assertions and observed failures remain separate categories. The coverage page shows up to 30 gaps with links to sealed architecture/source positions; file evidence is expandable.
- **Check scope:** planned, executed, excluded, omitted and missing checks remain visible. A reduced check plan cannot imply that all project checks ran.

Version 2 reports bind the run, commit, source inventory, check configuration and execution observations. Both execution-boundary observations must establish that tracked inputs matched the recorded commit. Historical Git blobs and sealed coverage are used; current worktree edits never substitute for historical code. Older records without this proof retain unknown conclusions. Source changes or identity mismatches produce `evidence-insufficient`.

Verification gaps are informational and do not change `run --ci` exit codes. Explicit required behavior contracts retain the gates described below.

## Analysis bounds

Analysis supports up to 500 changed files, 1 MiB per source blob, 8 MiB of source blobs, 100,000 changed lines per file and 200,000 changed lines in total. Historical JSON reads are bounded to 32 MiB per artifact and 128 MiB across the run and its linked checks. Deleted, binary, non-UTF-8, oversized and unsupported source has unknown measurements; renames appear as deletion and addition.

When analysis cannot complete within its evidence or Git bounds, Canary retains an explicit unavailable result without invented zero counts. Automatic analysis preserves the original check exit code; manual `change-verify` returns exit code 5. Execution observations describe boundaries and tracked inputs; they are not continuous filesystem attestation.

## Behavior contracts

Executing code does not prove its behavior. Declare a check and assertion link explicitly:

```json
{
  "kind": "canary.project",
  "version": 1,
  "checks": [{ "id": "refund", "type": "command", "command": "node", "args": ["refund.test.mjs"] }],
  "contracts": [
    {
      "id": "duplicate-refund",
      "paths": ["src/refund.mjs"],
      "checkId": "refund",
      "assertionId": "reject-duplicate",
      "required": true
    }
  ]
}
```

After executing its actual deterministic assertions, the declared check emits one JSON report on stdout:

```json
{
  "kind": "canary.assertions",
  "v": 1,
  "method": "deterministic",
  "results": [{ "id": "reject-duplicate", "passed": true }]
}
```

This is a maintainer-declared link between behavior and an assertion, not an inferred causal relationship. A generic success message, missing assertion, duplicate ID, truncated report or model score cannot establish behavior verification. Keep logs separate from the report and set the process exit code to reflect assertion failures.

Contracts are informational by default. Only `required: true` creates a CI gate: false assertions fail, unknown evidence blocks. Required contracts retain full check scope when `--affected` is requested. Coverage and inference alone never create a gate.

## 中文说明

`run --ci/--port --base <ref>` 在检查完成后封存变更报告；`change-verify` 支持历史运行分析，`--summary` 返回有界摘要。页面分别展示变更执行覆盖、未知文件数、显式行为和验证缺口，并可定位封存源码。执行过代码不等于验证行为；旧记录、源码身份不匹配和无法测量的范围保持未知。普通缺口不改变 CI 退出码，只有明确设为 `required: true` 的行为契约形成门禁。
