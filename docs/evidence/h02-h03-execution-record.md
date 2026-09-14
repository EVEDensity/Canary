# H-02 / H-03 执行记录

## 基线与范围

- 执行日期：2026-09-14
- 任务规范：`docs/roadmap/04-controlled-hard-evolution.md#h-02` 与 `#h-03`
- 前置：H-01 策略与隔离

## H-02

新增 `@canary/hard-evolution` 候选工作区。提案只写 `.canary/candidates/<id>/tree`，不写原项目。授权必须是 owned/fork/authorized_copy。保护测试、阈值、保留集、依赖清单和策略目录。独立 `compareRuns` 验证；伪造 `approved/verified` 无效；失败/不可比不入队。

## H-03

`TrustedApplyer` 校验批准哈希、策略版本、基线、工作区内容哈希和用户文件冲突。soft 不能写源码。hard+auto 在授权与隔离策略满足时可本地应用。撤销阻断后续应用。崩溃恢复不把 applying 当成两次成功。无 push 授权则拒绝远端。外界副作用不能声称已回退。

## 回滚

删除 `@canary/hard-evolution` 与 `.canary/candidates` / `.canary/apply` 接线。已应用补丁需用 journal 回退，不能靠删历史恢复用户文件。
