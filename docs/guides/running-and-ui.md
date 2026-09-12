# 当前运行、UI、产物与 Replay

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

- 默认 loopback host 为 `127.0.0.1`、port 0 表示由系统分配；可配置 host/port，不建议暴露公网。
- 非 headless 且 `web.enabled !== false` 时，先创建 runId、监听、打印 `canary UI` 再执行用例，因此长运行期间可以打开页面看 SSE。
- `--headless` 或 `web.enabled: false` **不创建监听、不打开浏览器**。`--no-open` 仍监听但不自动打开。
- 页面包含运行概览/时间线、case 断言与轨迹、source/feature coverage、建议队列与 compare。现有截图是界面参考，不是本轮浏览器验收证据。
- 端口占用会以 `Port N is already in use` 失败退出。
- POST replay / improvements 需要 `x-canary-write-token`（页面由 CLI 注入）。CORS 不是写授权。
- SSE 支持事件 ID、重连与心跳；断连有 snapshot/poll 路径。SSE 游标只在当前进程有效；跨重启从 artifact 恢复快照，不恢复同一套 event id。
- Replay 的 HTTP hook 可执行新运行；没有 hook 时返回 CLI 命令。当前 hook 等待执行结束才返回，不是未来异步 task API。

## 产物

当前写入**项目根（配置文件所在目录）**的 `.canary/artifacts/<runId>/`：

- run.json、coverage.json、coverage-manifest.json；
- trajectory.json、trace.jsonl、evaluator.json；
- gate.json、improvement.json；
- 按 reporters 配置写 report.json / report.md / report.xml / report.console.txt；比较另写 comparison.json。

其中部分文件在执行中被反复覆盖；不是不可变、已签名的证据库。覆盖率产物可能带源码，脱敏也未覆盖所有通道；不要直接上传整个 artifact 目录。

## Replay 不等于历史实验复现

Replay 从当前配置加载相同 case IDs，创建带 replayOf 的新运行。它没有冻结历史源码、模型、用例和依赖，因此结果可能不同；也不是逐字播放旧轨迹。当前候选与 Replay 的项目定位限制见 [安装说明](getting-started.md)。
