# 安装与快速开始

## 安装源码

推荐使用 Node.js 24、pnpm 10.15.0 和 Git。平台与工具版本详情见[支持范围](support-matrix.md)。

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm canary run --port 4318 --no-open
```

打开 `http://127.0.0.1:4318` 查看交互式报告。仓库内置计划执行构建、类型检查、lint、格式检查、工作区测试和 Agent 回归。`pnpm demo` 启动内置 Agent 评估示例，`pnpm demo:headless` 输出无页面的示例报告。

## 安装全局命令

仓库内可执行 `node scripts/install-global.mjs` 注册用户级命令。也可使用对应系统的安装脚本，执行前审阅脚本内容。

```powershell
# Windows
 iwr -useb https://raw.githubusercontent.com/EVEDensity/Canary/main/scripts/install/install.ps1 | iex
```

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/EVEDensity/Canary/main/scripts/install/install.sh | bash
```

安装脚本完成源码获取、依赖准备、构建和用户级命令注册。克隆目录可用 `CANARY_DIR` 配置。安装当前工作树时使用 `node scripts/install-global.mjs --working-tree`，该模式记录源码状态与 CLI 哈希；更新后重新构建和安装。

全局命令可在项目目录或任意子目录执行。已有配置优先 `canary.project.json`，其次 `canary.config.ts`；没有配置时自动识别项目标记、workspace 和检查脚本，不生成额外配置。运行产物存放在被测项目 `.canary/artifacts`。没有可执行检查时明确报错，不会把发现项目当作验证通过。

## 接入另一个项目

准备项目自身依赖后即可执行，无需 Canary 配置：

```bash
canary run --ci
canary run --port 4318 --no-open
canary run --ci --project /path/to/project
```

识别规则见[自动项目检查](automatic-checks.md)。覆盖率按实际采集配置呈现，详见[评估与覆盖率](evaluation-and-coverage.md)。以下步骤适用于自定义检查和 Agent 用例；配置示例见[README](../../README.md#接入自己的项目)。

1. 普通项目放置 `canary.project.json`，参考 [项目检查指南](r4-project-checks.md)；Agent 项目也可使用 `canary.config.ts`，参考 [适配器说明](adapters-and-environment.md)。
2. 在该项目目录执行 `canary run`，或从任意目录传入 `--config <path>`（相对路径相对调用目录）。
3. 相对 entry/cases/coverage 路径及 artifacts 以配置所在目录为根。运行后核对终端打印的 artifact 路径。
4. 历史命令可加同样的 `--config`，读写同一产物根。

HTTP Agent 默认收到 `{ "input": <case input> }`。现有服务若只接受 `{ "message": ... }`，在 Agent 配置中加入 `requestField: "message"`；它只替换顶层字段名，不转换输入值或响应结构。已有的三个公开项目接入配置见 [R9 试点](../../integrations/r9-external/README.md)。

## 在 CI 中运行

运行 `canary run --ci`，输出单行 v1 JSON，生成 JSON/JUnit/CI 产物。支持项目检查与 Agent 用例，可依据退出码接入已有工作流。参数与退出码见 [CLI 契约](r0-cli-contract.md)。

启动器使用构建后的 CLI；更新源码后先执行 `pnpm build`。

默认发现不会越过 `.canary` 目录边界，避免 artifact/tmp 中的临时项目误用外层总计划。临时项目内自己的配置和显式 `--config` 仍有效。

## 固定版本、更新与卸载

用于可重复交付时，先在干净的源码仓库 `git checkout <commit-or-tag>`，再运行 `pnpm install --frozen-lockfile`、`pnpm build` 和 `node scripts/install-global.mjs`。记录实际 commit 和 `canary version --json`；不要把移动中的 main 视为固定版本。已有修改的源码安装仅在有意使用当前工作树时传入 `--working-tree`。

更新前保存源码修改，选定新版本，安装冻结依赖并重新注册启动器。全局安装根和被测项目根各自独立，`canary paths --json` 可核对目录。保留需要的项目历史产物。

Windows 的 `scripts/install/uninstall.ps1` 与 macOS/Linux 的 `scripts/install/uninstall.sh` 移除启动器、注册信息和 Canary 写入的 PATH 项；它们不删除被测项目 `.canary` 产物。执行前阅读脚本。卸载源码启动器后，仓库内仍可用 `pnpm canary`。

## 首次运行问题

- **找不到 canary：** 全局安装后新开终端，或在源码仓库使用 `pnpm canary`。
- **未识别检查：** 核对项目已有脚本及语言标记，用 `--project` 指定被测目录；特殊检查可显式传入 `--config`。
- **缺 dist/包导出：** 在 Canary 源码仓库先执行 `pnpm build`；目标项目依赖需单独准备。
- **端口被占用：** 关闭旧页面服务或换一个 `--port`。页面仅监听回环地址。
- **覆盖率不可用：** 核对测量来源和声明范围；普通命令通过不意味着全仓覆盖率已采集。
- **失败位置未知：** 当前只定位可识别日志/堆栈；保留脱敏原始证据和检查命令，不将推断当根因。

问题反馈提供版本、系统、调用目录、配置和最小复现；先审查日志和截图。完整维护步骤见[贡献指南](../../CONTRIBUTING.md)，安全问题见[安全策略](../../SECURITY.md)。
