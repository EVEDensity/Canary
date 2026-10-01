# 本地日志与快速维护

## 目录和日常命令

先运行 `pnpm build`；测试与验收脚本沿用已构建的执行器和脱敏模块。

```sh
pnpm test:quick
pnpm logs:status
pnpm logs:prune
```

`test:quick` 只验证日志路径、退出码、脱敏、限量和清理边界，通常几秒完成，不调用模型。完整测试仍是 `pnpm test`，结果自动保存到 `.canary/logs/tests/<时间-随机ID>/`。验收入口保存到 `.canary/logs/verification/<阶段>/<时间-随机ID>/`。终端会打印本次目录。

stdout/stderr 分别保存开头、错误附近与末尾上下文，每流少于 70,000 字符；日志说明是否省略了中间输出。终端输出保持原样，落盘内容先脱敏。结束时保存最终日志；强制杀进程可能只留下 running 记录及锁，不能视为通过。

`logs:status` / `logs:prune` 默认只预览：显示总占用、受保护记录、可回收大小和候选路径。默认建议保留最近 20 次，超过 30 天或条数限制的已完成日志可以清理。真正删除必须显式执行：

```sh
pnpm logs:prune --apply
```

只处理 `.canary/logs/` 中带 `canary.local-log` 元数据且无锁的已完成目录；运行中、未知格式、旧归档和符号链接不清理。不会触及 `.canary/artifacts/`、历史验收证据、源码或凭据。

## 运行中断

当前日志包装器在 Ctrl+C 时终止其子进程树。无法确认结束的记录保留 running/锁，不自动删除。Canary 检查自身仍使用原有 checkpoint 和 stale-run 恢复；下一次正常运行会检查遗留状态，不把半写 artifact 算作成功。
