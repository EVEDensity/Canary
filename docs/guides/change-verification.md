# Change verification

```bash
canary change-verify <runId> --base <commit-or-ref>
```

The report compares a sealed run's commit with the resolved baseline, reads historical Git blobs and uses that run's architecture and coverage evidence. It never substitutes current source for historical code. Changed executable lines, functions and branches retain their denominators. Missing coverage, approximate maps, deleted source and unavailable black-box code remain unknown. Observed failures and uncovered paths remain distinct.

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

Contracts are informational by default. Only `required: true` creates a CI gate: false assertions fail, unknown evidence blocks. Required contracts retain full check scope when `--affected` is requested. Coverage and inference alone never create a gate. The workspace coverage view lists changed files and links them to their architecture/source nodes.

## 中文说明

命令对比封存运行的提交与基线，分别展示变更执行覆盖、失败证据和显式行为契约。没有覆盖产物、映射精度不足和黑盒代码显示未知。普通检查通过不能代表行为已验证；项目需声明检查与断言的对应关系，并输出真实确定性断言结果。只有明确设为 `required: true` 的契约会形成 CI 门禁。
