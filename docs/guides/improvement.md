# 当前 improvement：建议、草稿与人工候选

> **当前不自动修改 Agent 源码或启用新的 Prompt/Skill。** 理想闭环见 [自循环设计](../design/agent-loop.md)，不要混用目标模式名作为现有命令。

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
- compare 当前仅按结果比较输出 improve/keep/reject；candidate/compare 的退出码不能代替完整准入门禁。

## 使用前必须知道的限制

1. 草稿生成可能丢失断言操作数，且缺失 input 时使用 output 兜底；审阅原始输入、完整断言与可信预期，再决定是否纳入回归集。
2. 当前 holdout 识别使用 caseId 字符串，不读取 tags 来构建隐藏集合；标记 holdout 不等于保护数据。
3. compare 以 caseId 建 Map，会覆盖重复执行；候选缺失已通过用例不一定被判回归；缺失 coverage 按 0 做差。
4. CLI candidate 末尾按比较 verdict 返回，而不是保证已整合 executed.exitCode、评估完整性和所有门禁。
5. 现有建议状态、比较报告和未来发布许可必须分开。生产变更不能据此自动应用。

具体代码、已复现的最小反例见 [源码核对](../evidence/code-audit.md)；补强任务集中在 [Q 系列任务](../roadmap/02-evaluation-integrity.md)。
