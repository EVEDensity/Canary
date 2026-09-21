# 本轮实际验证基线

## 环境和范围

- 代码：`30f11cf4a303ab8616fb702bad8348bba4955466`，Windows / PowerShell。
- 环境记录时间：`2026-09-13T00:42:55.1191463+08:00`（UTC 为 2026-09-12 16:42:55）。命令在随后执行；不要把本地日期与 UTC 日期当成两轮结果。
- Node：`v24.18.0`；pnpm：`10.15.0`。
- 使用现有依赖；没有运行依赖安装或全局安装脚本，没有修改运行时源码。
- 日志为实际终端输出，转为 UTF-8、移除 ANSI，并替换本机绝对工作区/临时目录。日志中的耗时属于本机单次观察，不是性能承诺。文件使用 `.txt` 扩展名，避免被仓库现有 `*.log` 忽略规则排除；未修改忽略配置。

## 执行结果

| 命令               | 退出码 | 结果/日志                                                                   |
| ------------------ | ------ | --------------------------------------------------------------------------- |
| pnpm build         | 0      | [build.txt](logs/baseline/build.txt)                                        |
| pnpm test          | 0      | 17 个测试文件 / 105 个测试，[test.txt](logs/baseline/test.txt)              |
| pnpm typecheck     | 0      | [typecheck.txt](logs/baseline/typecheck.txt)                                |
| pnpm lint          | 0      | [lint.txt](logs/baseline/lint.txt)                                          |
| pnpm demo:headless | 0      | 默认 Demo 15/15 cases、45/45 assertions，[demo.txt](logs/baseline/demo.txt) |

默认 `pnpm test` 包含 coverage fixture；CI 单独 fixture job 是额外重复，不应重复计入这里的 105。

| 包          | 文件数 | 测试数 |
| ----------- | ------ | ------ |
| core        | 1      | 5      |
| evaluators  | 1      | 13     |
| environment | 1      | 2      |
| adapters    | 1      | 6      |
| coverage    | 6      | 22     |
| reporters   | 1      | 5      |
| trace       | 1      | 3      |
| improvement | 1      | 5      |
| runner      | 1      | 16     |
| web         | 1      | 10     |
| cli         | 2      | 18     |
| 合计        | 17     | 105    |

## 默认 Demo 快照

run ID：`run_e96f38e9-7cc3-4adc-8431-de9217eaee0b`。产物在本地忽略目录 `.canary/artifacts/<runId>/`，没有将整个运行产物提交到文档。

| 维度       | covered / total | pct    |
| ---------- | --------------- | ------ |
| lines      | 78 / 79         | 98.73% |
| functions  | 20 / 20         | 100%   |
| branches   | 37 / 48         | 77.08% |
| statements | 80 / 87         | 91.95% |

这是默认示例的采集结果，不是整个 Canary 仓库的测试覆盖率，也不是 Agent 智能评分。不能直接与不同示例/分母的历史百分比评判进步。

## 未执行或不能由本轮证明的项目

- 干净环境安装、全局 launcher 的跨平台真实安装、npm/二进制发布与下载可用性。
- 浏览器手动交互、多宿主 Skill/MCP、本地 Ollama、真实付费 Judge。
- Linux/macOS、容器或 OS 级沙箱、渗透验证、真实外部副作用回滚。
- 自动软进化、自动硬进化、持续控制器和生产发布。
- 论文实验复现、通用 Agent 能力单调提升。

现有测试通过与[已发现缺口](code-audit.md)同时成立；不能据绿灯批准自动应用代码。文档迁移/链接/格式核验另在[迁移记录](document-migration.md)汇总。
