# Canary Week 2 Plan

> 目标：把 Week 1 的“能够运行”推进到“能够准确评估 Agent”。
> 焦点：**可信 Coverage + Agent 行为断言 + Feature Chain 可视化闭环**

## 总目标

1. 更可靠地量化 TypeScript Agent 的函数、分支、语句覆盖率。
2. 区分运行成功、输出断言失败、轨迹断言失败、超时、取消、运行异常。
3. 将功能链路注册为 Feature，并展示覆盖情况。
4. 通过 SSE 将 Coverage 和评测状态推到 Web UI。
5. 读取历史 `.canary/artifacts/<runId>/run.json`，支持 Run Replay。
6. CLI、Runner、Coverage、Evaluator、Web 保持解耦。
7. 新增能力必须有单元、集成或 E2E 测试。

## P0

- Coverage Manifest、TypeScript AST、V8 / source-map 映射、Windows / `file://` 路径、source hash、quality fallback。
- Agent-oriented Evaluator：schema、predicate、required/forbidden events、step/tool limits、termination、error recovery、latency、budget。
- Feature Chain：Definition → Registry → expectedFeatures → execution event → assignment → Run Summary → Web/SSE。

## P1

- 实时 Coverage：V8 sample → child IPC → Runner → RunStore → SSE；去重、provisional/final、退出收尾。
- Artifact Replay：`FileArtifactRepository` hydrate RunStore；Web 启动后可读历史 run。
- Case Discovery：include/exclude、`**` 匹配 0 层或多层目录、稳定排序、重复 ID、非法 schema、无匹配报错。

## Day 5 收尾

- CLI：`canary run`、`canary runs`、`canary show <runId>`；run 结束后打印摘要。
- `trajectory.json` 写入完整 events。
- `evaluator.json` 写入 execution / evaluation 结构。
- 真实命令验收，只把实际执行过的路径记入 `WEEK-2-ISSUES.md`。

## 暂不作为本周主线

完整 MCP Runtime、外部 API Mock 平台、分布式 Runner、安全沙盒、自动改源码、云端 Dashboard、Istanbul 全语义。
