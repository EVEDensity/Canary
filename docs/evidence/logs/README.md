# 验收证据归档

这里保留可供代码评审的结构化验收报告，按阶段分目录。阶段结论与验证范围见上级目录的执行记录。

2026-09-30，98 份历史文本日志移至 `.canary/logs/archive/evidence/<阶段>/`，逐文件核对 SHA-256 后从提交内容移除。原文件路径、字节数和哈希保留在 [归档索引](archive-index.json)。原始内容也可从 Git 历史读取，例如 `git show 74cc1f5:docs/evidence/logs/r0/r0-build.txt`。文档中的“归档”日志链接统一指向本说明。

报告中的绝对路径、日期和源码哈希属于执行当时的记录，不代表当前源码已经再次执行。

日常测试不再默认写入这里：

- `pnpm test`：`.canary/logs/tests/<时间-随机ID>/`。
- `pnpm test:quick`：`.canary/logs/quick/<时间-随机ID>/`。
- `pnpm verify:r*`：`.canary/logs/verification/<阶段>/<时间-随机ID>/`。
- 每次运行独立保存 `stdout.log`、`stderr.log` 和 `result.json`；验收入口同时保存结构化报告。
- `.canary/logs/archive/` 保存根目录旧临时日志，已忽略；不作为公开验收文件自动上传。

提交正式证据时，通过脚本的 `--out` / `--output` 或相应 `CANARY_*_OUTPUT` 导出必要的结构化摘要，并同步更新执行记录。文本日志保留在 `.canary/logs/`，原始 artifact 保留在各项目 `.canary/artifacts/`，不会被日志清理命令删除。
