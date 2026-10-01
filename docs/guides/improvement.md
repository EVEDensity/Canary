# improvement：建议、草稿与人工候选

```text
run → 失败归因 → suggestion(proposed)
    → accept / reject → verify（写入回归草稿）
    → 人工准备候选 entry → candidate / compare
```

## 已有命令

```text
canary improve <runId> [--out <dir>]
canary suggest <runId> [--accept|--reject|--verify <suggestionId>] [--out <dir>]
canary candidate <baselineRunId> --entry <candidate-entry> [--config <path>] --headless
canary compare <baselineRunId> <candidateRunId>
```

- improve 会生成并写出回归草稿；它不是修改 Agent 的命令。输出目录默认规则见 CLI 中 defaultRegressionDir，可能落到项目 cases/regression 或示例目录。
- accept/reject/verify 改变建议状态；verify 要求 accepted，随后可写入默认回归目录。**此 verified 不代表独立实验已验证候选正确。**
- candidate 运行人工提供的 entry，选择基线 case IDs，然后比较；命令本身不生成补丁、不合并代码，也不建立隐藏评估集。
- compare 输出 `improve` / `keep` / `reject` / `incomparable` 以及独立的 `admission`；candidate/compare 合并候选退出码与完整性，仍不是发布许可。

## 使用前必须知道的限制

1. 无法恢复原始 input 或不可序列化断言（predicate/schema）时拒绝生成草稿，不伪造 Case。`accepted`/`verified` 不是执行证据。
2. holdout 使用 `tags` 或 `dataset.split`，仅凭 caseId 含 “holdout” 不会进入保留集。
3. compare 按 trial 键（`caseId` 或 `caseId#repetition`）对账；缺测、重复 ID、取消/超时不能得到 improve/keep。
4. CLI candidate 合并本次 `exitCode`、`incomparable` 与 admission reject；`hold` 表示不要自动应用。
5. 现有建议状态、比较报告和未来发布许可必须分开。生产变更不能据此自动应用。
