# 本地日志与快速维护

## 目录和日常命令

先运行 `pnpm build`；测试与验收脚本沿用已构建的执行器和脱敏模块。

```sh
pnpm test:quick
pnpm logs:status
pnpm logs:prune
```

`test:quick` 保留日志路径、退出码、脱敏、限量和清理边界测试，并实际验证官方 Skill 的安装、重复安装、更新、冲突保护、回滚和移除，通常几秒完成，不调用模型。完整测试仍是 `pnpm test`，结果自动保存到 `.canary/logs/tests/<时间-随机ID>/`；快速测试保存到 `.canary/logs/quick/<时间-随机ID>/`。验收入口保存到 `.canary/logs/verification/<阶段>/<时间-随机ID>/`。终端会打印本次目录。

stdout/stderr 分别保存开头、错误附近与末尾上下文，每流少于 70,000 字符；日志说明是否省略了中间输出。终端输出保持原样，落盘内容先脱敏。结束时保存最终日志；强制杀进程可能只留下 running 记录及锁，不能视为通过。

`logs:status` / `logs:prune` 默认只预览：显示总占用、受保护记录、可回收大小和候选路径。默认建议保留最近 20 次，超过 30 天或条数限制的已完成日志可以清理。真正删除必须显式执行：

```sh
pnpm logs:prune --apply
```

只处理 `.canary/logs/` 中带 `canary.local-log` 元数据且无锁的已完成目录；运行中、未知格式、旧归档和符号链接不清理。不会触及 `.canary/artifacts/`、历史验收证据、源码或凭据。

## 运行中断

当前日志包装器在 Ctrl+C 时终止其子进程树。无法确认结束的记录保留 running/锁，不自动删除。Canary 检查自身仍使用原有 checkpoint 和 stale-run 恢复；下一次正常运行会检查遗留状态，不把半写 artifact 算作成功。

## 分析开销与改进会话恢复

```sh
canary profile <runId> --samples 3 --json
canary improvement recover <sessionId> --json
canary improvement recover <sessionId> --apply --session-hash <sessionHash> --lock-hash <lockHash-or-absent> --actor maintainer --reason "Close the interrupted attempt" --json
```

`profile` 支持 1–5 次顺序采样，默认 1 次；只读测量项目发现、结构构建、证据核验、质量简报和项目记忆检索，不加载可执行配置，不运行检查、Agent 或模型。报告包含各阶段实际耗时、输入范围、可用身份、未知原因及下一步。采样描述当前工作负载，不代表生产延迟保证；时间预算在同步操作之间检查。

`improvement recover` 默认只预览。执行恢复需要 `--apply`、当前会话与锁哈希，以及操作者和原因；预览无锁时传入字面值 `absent`。仅在确认原所有者已退出时关闭中断账本，未知指标保持 `null`，已消耗的 attempt 不退回；不会重跑、认定修复成功或向持久化 PID 发送终止信号。活跃、未知、身份不匹配或发生变更的所有者阻止恢复，残留恢复锁保留供检查。

受控改进的配置加载使用 Worker 和响应式 supervisor，处理超时、取消、输出超限与父连接断开；它不提供操作系统沙箱。

## Artifact 保留

配置 `artifacts.retention` 后，先预览运行证据清理计划，再显式应用：

```sh
canary prune --config <config> --json
canary prune --config <config> --apply --json
```

质量决策和改进会话引用的 baseline、candidate 与谱系依赖均受保护。计划包含引用/运行集合哈希、受保护 run ID 和阻塞原因；记录损坏、链接文件、半写入、残留锁或计划后发生变更时拒绝清理。应用期间与受管决策、改进和恢复操作互斥。受管运行保留集合租约；artifact、决策、改进和保留策略通过维护屏障登记，归档期间拒绝竞争写入。外部程序直接修改文件不属于该互斥协议。

保留规则可能因证据保护而无法满足数量或空间目标；不会为满足配额删除被引用证据。改进存储上限为 64 个会话，达到上限后保留已有记录；可通过 [完整证据归档](evidence-archive.md) 的 `archive create --rotate` 整套移动运行及引用记录，再建立空集合。不要单独移动会话文件绕过上限。`logs:prune` 仍仅清理日志，与 artifact 保留相互独立。
