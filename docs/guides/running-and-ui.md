# 运行、UI、产物与 Replay

默认入口优先选择最近配置目录中的 `canary.project.json`，同目录缺少它时使用 `canary.config.ts`。项目检查与 Agent 评估现在共用[统一工作台](unified-workspace.md)。项目重跑与开关见 [R5 指南](r5-local-report.md)。以下 case/trajectory/coverage/replay 说明针对 Agent 配置；在本仓库需显式加 `--config canary.config.ts`。

## 已有命令

全局命令下使用以下语法；仓库内可用 `pnpm canary -- <command>`。尖括号是占位符。

```text
canary run [--config <path>] [--entry <path>] [--case <id>] [--tag <tag>]
           [--repetitions <n>] [--port <n>] [--headless] [--no-open]
canary runs
canary show <runId>
canary report <runId> --format json|markdown|junit|console
canary replay <runId> [--config <path>] [--headless] [--no-open]
```

repetitions 运行 case × N；用例自身 options.repetitions 优先于 CLI/运行默认值，caseId 相同的不同执行需看 repetition/executionId。tag 可重复传入，当前按任一 tag 匹配。

## UI 生命周期

## 产物

当前写入**项目根（配置文件所在目录）**的 `.canary/artifacts/<runId>/`：

- run.json、coverage.json、coverage-manifest.json；
- checkpoint.json、run.lock、tmp/、work/（运行隔离与崩溃收尾；不是签名证据）；
- trajectory.json、trace.jsonl、evaluator.json；
- gate.json、improvement.json；
- 按 reporters 配置写 report.json / report.md / report.xml / report.console.txt；比较另写 comparison.json。

执行中的文件会更新；结束时 R3 manifest 封存并校验内容，页面和导出使用脱敏快照。该机制不是数字签名或对任意第三方检查的安全证明，详见 [R3 证据说明](r3-artifact-evidence.md)。

## Replay 不等于历史实验复现

Replay 从当前配置加载相同 case IDs，创建带 replayOf 的新运行。它没有冻结历史源码、模型、用例和依赖，因此结果可能不同；也不是逐字播放旧轨迹。当前候选与 Replay 的项目定位限制见 [安装说明](getting-started.md)。
