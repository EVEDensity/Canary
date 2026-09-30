# R4/R5 默认入口与全局安装收尾

日期：2026-09-20。范围：Windows Node 24；保留 R3–R6 未提交改动，不扩大 R6 平台结论。

## 当前行为

- 显式 `--config` 优先；否则逐层向上查找最近配置目录。同一目录 `canary.project.json` 优先于 `canary.config.ts`；较近的 Agent 配置优先于较远的项目配置。
- 默认查找在 `.canary` 边界停止，防止临时项目误用外层总计划；显式配置不受该边界限制。
- 无效项目 JSON 直接报错，不隐式回退到 Agent demo；缺配置返回 2，安装根不充当被测项目。
- 仓库默认计划包含六个必需检查：build、typecheck、lint、format:check、全仓 test、Agent 回归。后五项依赖 build；总预算 15 分钟，各检查另有超时。
- `pnpm demo` / `pnpm demo:headless` 显式选择 Agent 配置；历史 R0 验收也显式选择该配置，避免把完整门禁误当作旧 demo。
- CLI `report` 传递完整 RunSnapshot，保留项目 checks 字段。

## 全局安装

本轮明确执行 `node scripts/install-global.mjs --working-tree`，把当前源码工作区注册为全局安装根。默认安装仍拒绝 dirty checkout；显式工作区模式保留 Git 状态，元数据记录 sourceDirty、基线 ref 和构建 CLI 哈希，不执行 git checkout/reset。不能与 CANARY_REF 同用。

启动器位于 `%LOCALAPPDATA%/canary/bin/canary.cmd`，安装元数据位于 `~/.canary/home.json`，用户 PATH 已登记。安装器自动备份旧元数据和旧启动器；备份路径见安装日志。当前已打开的终端不会自动获得新 PATH，需要重开终端。

源码安装是链接当前 checkout 的模式。修改源码后需 build；移动或删除 checkout 会影响启动器。未提交、推送或发布包。

## 验收方式

`pnpm verify:entry --self` 使用实际已安装的全局命令，在 Windows 从用户/系统注册的 PATH 构造新进程环境；不会创建另一个临时 launcher 冒充安装验收。

验收包括：独立项目及带空格子目录、项目 JSON 默认优先、显式 Agent 配置、无效/缺失配置不回退、项目报告导出、两个项目隔离、指定随机端口的运行中页面、关闭服务后证据封存，以及从 Canary 子目录执行完整默认门禁。

结构化结果保存为 `logs/entry/entry-acceptance.json`；运行产生的临时项目保留供审计，位置在结果中。全局页面测试使用空闲端口以避免干扰用户服务，并在验收结束时关闭监听。

## 使用

```powershell
# 在 Canary 仓库或已配置项目目录中
canary run --ci
canary run --port 4318
canary run --port 4318 --no-open
# 本仓库显式运行原 Agent demo
canary run --config canary.config.ts
```

普通 run 与 CI 使用同一检查计划；CI 不启动网页，`--no-open` 保留网页服务。项目只能执行显式配置中的检查，不推导为自动执行任意仓库全部脚本。

## 回退

配置选择可用 `--config canary.config.ts` 恢复原 Agent 入口。代码回退仅撤回本轮 home/report/计划及安装选项修改，保留 R3–R6。全局安装回退可恢复安装日志中备份的 home.json 和启动器；PATH 新增项应仅按该安装 binDir 精确处理，不覆盖其他用户配置。

## 验收中发现并修复的问题

真实全局门禁首先发现 R6 扩展 cwd 对短路径 `node --run` 的回归，现仅在 Windows 路径长度达到 260 时使用扩展路径，并增加包脚本回归测试。随后发现隔离临时目录中的无配置 fixture 向上误选根项目计划，现增加 `.canary` 默认发现边界并补测；旧失败 artifact 和原始日志均保留。没有删除失败证据或减少必需检查。

隔离用户目录下的 `doctor` 还暴露了 pnpm 探测问题：在项目内执行版本命令可能触发 `packageManager` 版本加载，实测达到 3 秒超时；在 Node 可执行文件目录探测全局 pnpm 则约 0.6 秒完成。探测现使用后者，避免占用被测临时项目；该字段表示全局可执行工具版本。未放宽测试超时或跳过失败断言。

## 本轮结果

- Windows / Node 24.18.0，实际全局安装与 `pnpm verify:entry --self` 成功，七组入口验收全部 verified：[结构化结果](logs/entry/entry-acceptance.json)、[运行日志（归档）](logs/README.md)、[安装日志（归档）](logs/README.md)。
- 从 `packages/cli` 子目录启动默认项目门禁，runId 为 `run_0d01f3f2-367d-4db2-a53a-d2eeb6b11bf3`，六项 required checks 全部 passed，manifest 校验 verified。build / typecheck / lint / format / test / Agent 分别约 9.6 / 9.2 / 4.8 / 2.4 / 73.3 / 57.1 秒。
- 指定端口 57606 的运行中页面及 API 验证通过；跨项目读取返回 404，关闭服务后进程正常退出、证据封存通过。该端口仅用于验收，现已关闭。
- 隔离环境下 R0/R2 的 36 项测试通过，含缺配置、脱敏、安装根隔离与诊断：[日志（归档）](logs/README.md)。Windows 超长路径的真实全局 CI 回归通过：[日志（归档）](logs/README.md)。
- 旧 R0 兼容验收通过：显式 Agent 配置、pnpm 入口、缺配置退出及执行前后源码哈希核对均 verified：[结果](logs/entry/entry-r0.json)。
- 完整门禁的测试输出超过 64 KiB，持久化输出按已有规则标记 omitted；通过结论依据进程退出码及已封存 check 结果，不声称该 artifact 保存了全部测试控制台日志。

这是当前 Windows 源码全局安装的实测结果，不扩展为 macOS、原生 Ubuntu 或 Pi 的新增验收结论。全局命令执行调用项目的显式计划；无配置目录仍需先建立项目配置。
