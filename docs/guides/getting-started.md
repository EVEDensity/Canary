# 安装与启动：当前行为

## 仓库内运行（本轮实际验证的路径）

要求来自根 package.json：Node.js ≥22、pnpm 10.15.0；安装脚本另需 Git。本轮测试环境与范围见 [验证记录](../evidence/validation-baseline.md)。

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

1. 普通项目放置 `canary.project.json`，参考 [项目检查指南](r4-project-checks.md)；Agent 项目也可使用 `canary.config.ts`，参考 [适配器说明](adapters-and-environment.md)。
2. 在该项目目录执行 `canary run`，或从任意目录传入 `--config <path>`（相对路径相对调用目录）。
3. 相对 entry/cases/coverage 路径及 artifacts 以配置所在目录为根。运行后核对终端打印的 artifact 路径。
4. 历史命令可加同样的 `--config`，读写同一产物根。

## 无交互 CI 契约

已配置项目可运行 `canary run --ci`，输出单行 v1 JSON、不启动页面，并保留 JSON/JUnit/CI artifact。支持显式项目检查计划及 Agent cases；只执行选中配置中的检查，不会自动运行未知仓库的全部脚本。根目录、参数与退出码见 [R0 CLI 契约](r0-cli-contract.md)。

源码 launcher 现在执行构建后的 CLI；更新源码后先 `pnpm build`。R0 验收不自动重装或覆盖已有全局 launcher。

默认发现不会越过 `.canary` 目录边界，避免 artifact/tmp 中的临时项目误用外层总计划。临时项目内自己的配置和显式 `--config` 仍有效。
