# 安装与启动：当前行为

## 仓库内运行（本轮实际验证的路径）

首次源码安装建议使用 Node.js 24、pnpm 10.15.0 和 Git。根运行时声明为 Node.js ≥22，但源码开发工具 ESLint 10 要求 Node 22.13+ 或 Node 24+，因此不要将根声明当成全部工具的最低版本验收。已验证范围见[支持与证据矩阵](support-matrix.md)。

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm demo:headless
# 需要浏览器：
pnpm demo
```

运行前 build 很重要：示例和工作区包使用编译后的 dist 导出。默认运行优先选择根 `canary.project.json`，执行 build、typecheck、lint、格式检查、全仓测试和 Agent 回归。`pnpm demo` / `pnpm demo:headless` 显式选择 `canary.config.ts`，继续运行 local-agent 示例。

## 已有的一行全局安装脚本

先审阅远程脚本内容，再决定是否执行；本轮没有重新安装或验证外部分发服务。

```powershell
# Windows
 iwr -useb https://raw.githubusercontent.com/EVEDensity/Canary/main/install.ps1 | iex
```

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/EVEDensity/Canary/main/install.sh | bash
```

脚本 clone/update 仓库，安装依赖、build、写入用户级 home 注册文件和启动器，并修改用户 PATH；不是独立二进制安装。克隆目录可用 `CANARY_DIR` 配置。已克隆的干净仓库可执行 `node scripts/install-global.mjs`；明确安装当前未提交版本时使用 `node scripts/install-global.mjs --working-tree`。该模式记录 dirty 状态和 CLI 哈希，不执行 git reset/checkout；更新源码后需重新 build。不要把源码中的发布 workflow 当成 npm 包当前可用性的证明。

**当前全局启动器保留调用目录（`process.cwd()`），并把 `CANARY_HOME` 设为安装仓库。** 从调用目录逐层向上查找最近配置目录，同目录优先 `canary.project.json`，其次 `canary.config.ts`。找到配置后，则运行该项目并把产物写到该项目的 `.canary/artifacts`。没有本地配置时报告配置缺失，绝不回退到安装 Demo（CI 退出码 2）。要跑 Demo，请显式进入 Canary 仓库或指定其配置。`runs` / `show` / `report` / `compare` / `improve` 与 `run` 使用同一套 `ProjectContext`；可用 `--config` 显式指定。

## 接入另一个项目

完整的两项普通项目配置示例见[README 快速开始](../../README.md#接入自己的项目)。先安装目标项目自身依赖；`command` 检查只执行声明的命令，不自动采集整个项目覆盖率。

1. 普通项目放置 `canary.project.json`，参考 [项目检查指南](r4-project-checks.md)；Agent 项目也可使用 `canary.config.ts`，参考 [适配器说明](adapters-and-environment.md)。
2. 在该项目目录执行 `canary run`，或从任意目录传入 `--config <path>`（相对路径相对调用目录）。
3. 相对 entry/cases/coverage 路径及 artifacts 以配置所在目录为根。运行后核对终端打印的 artifact 路径。
4. 历史命令可加同样的 `--config`，读写同一产物根。

HTTP Agent 默认收到 `{ "input": <case input> }`。现有服务若只接受 `{ "message": ... }`，在 Agent 配置中加入 `requestField: "message"`；它只替换顶层字段名，不转换输入值或响应结构。已有的三个公开项目接入配置见 [R9 试点](../../integrations/r9-external/README.md)。

## 无交互 CI 契约

已配置项目可运行 `canary run --ci`，输出单行 v1 JSON、不启动页面，并保留 JSON/JUnit/CI artifact。支持显式项目检查计划及 Agent cases；只执行选中配置中的检查，不会自动运行未知仓库的全部脚本。根目录、参数与退出码见 [R0 CLI 契约](r0-cli-contract.md)。

源码 launcher 现在执行构建后的 CLI；更新源码后先 `pnpm build`。R0 验收不自动重装或覆盖已有全局 launcher。

默认发现不会越过 `.canary` 目录边界，避免 artifact/tmp 中的临时项目误用外层总计划。临时项目内自己的配置和显式 `--config` 仍有效。

## 固定版本、更新与卸载

用于可重复交付时，先在干净的源码仓库 `git checkout <commit-or-tag>`，再运行 `pnpm install --frozen-lockfile`、`pnpm build` 和 `node scripts/install-global.mjs`。记录实际 commit 和 `canary version --json`；不要把移动中的 main 视为固定版本。已有修改的源码安装仅在有意使用当前工作树时传入 `--working-tree`。

更新前保存源码修改，选定新版本，安装冻结依赖并重新注册启动器。全局安装根和被测项目根各自独立，`canary paths --json` 可核对目录。保留需要的项目历史产物。

Windows 的 `uninstall.ps1` 与 macOS/Linux 的 `uninstall.sh` 移除启动器、注册信息和 Canary 写入的 PATH 项；它们不删除被测项目 `.canary` 产物。执行前阅读脚本。卸载源码启动器后，仓库内仍可用 `pnpm canary`。

## 首次运行问题

- **找不到 canary：** 全局安装后新开终端，或在源码仓库使用 `pnpm canary`。
- **找不到配置：** 在被测项目放置 `canary.project.json`，或显式传入 `--config`；先用 `canary paths --json` 核对选择。
- **缺 dist/包导出：** 在 Canary 源码仓库先执行 `pnpm build`；目标项目依赖需单独准备。
- **端口被占用：** 关闭旧页面服务或换一个 `--port`。页面仅监听回环地址。
- **覆盖率不可用：** 核对测量来源和声明范围；普通命令通过不意味着全仓覆盖率已采集。
- **失败位置未知：** 当前只定位可识别日志/堆栈；保留脱敏原始证据和检查命令，不将推断当根因。

问题反馈提供版本、系统、调用目录、配置和最小复现；先审查日志和截图。完整维护步骤见[贡献指南](../../CONTRIBUTING.md)，安全问题见[安全策略](../../SECURITY.md)。
