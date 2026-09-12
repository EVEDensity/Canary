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

运行前 build 很重要：示例和工作区包使用编译后的 dist 导出。默认配置是根 `canary.config.ts`，目标为 local-agent 示例，不是自动发现任意项目的 Agent。

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

脚本 clone/update 仓库，安装依赖、build、写入用户级 home 注册文件和启动器，并修改用户 PATH；不是独立二进制安装。克隆目录可用 `CANARY_DIR` 配置。已克隆仓库可执行 `node scripts/install-global.mjs`。不要把源码中的发布 workflow 当成 npm 包当前可用性的证明。

**当前全局启动器把子进程 cwd 固定到安装仓库。** 因此通常在任意目录输入 `canary run` 会运行安装仓库的 Demo，而不是当前项目；`INIT_CWD` 等环境因素还可能影响解析。目录自动解析本身也会回退到 `CANARY_HOME` 或用户 home 注册项。这两个行为都已列为待修正任务。

## 接入另一个项目

1. 明确被测项目中的配置、Agent entry、用例与 coverage scope，参考 [适配器说明](adapters-and-environment.md)。不要把无法识别的项目当成自动完成了接入。
2. 当前全局启动器下，运行目标项目应传入配置的**绝对路径**：`canary run --config <absolute-config-path> --headless --no-open`。尖括号内容需要替换。
3. 相对 entry/cases/coverage 路径及 artifacts 以该配置所在目录为根。运行后核对终端打印的 artifact 路径。
4. 历史命令 `runs/show/report/compare/improve` 当前没有统一 `--config/--project` 入口；不要假设它们会自动找到第 2 步的外部项目。可在正确项目目录直接调用已构建 CLI，而不是使用会重置 cwd 的全局启动器。

未来目标是“全局安装 → 在当前项目执行 → 无配置时引导，不静默 Demo”，见 [产品架构](../design/product-architecture.md)；目前尚未实现。
