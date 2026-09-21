# 验收证据归档

这里保存经过选择、可供代码评审的历史证据，按阶段分目录：`r0`–`r6`、`s01/s03/s04`、`entry`、`issue-closure`、`workspace`、`baseline`。

2026-09-21 将原目录的 138 个文件归档，逐文件核对 SHA-256；内容未改写。报告中的绝对路径、日期和源码哈希属于执行当时的记录，不代表当前源码已经再次执行。

日常测试不再默认写入这里：

- `pnpm test`：`.canary/logs/tests/<时间-随机ID>/`。
- `pnpm test:quick`：`.canary/logs/quick/<时间-随机ID>/`。
- `pnpm verify:r*`：`.canary/logs/verification/<阶段>/<时间-随机ID>/`。
- 每次运行独立保存 `stdout.log`、`stderr.log` 和 `result.json`；验收入口同时保存结构化报告。
- `.canary/logs/archive/` 保存根目录旧临时日志，已忽略；不作为公开验收文件自动上传。

要提交一份新的正式证据，显式使用脚本的 `--out` / `--output` 或相应 `CANARY_*_OUTPUT` 设置导出位置，并同步更新执行记录。原始 artifact 继续保留在各项目 `.canary/artifacts/`，不会被日志清理命令删除。
