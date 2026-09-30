<div align="center">
  <img src="docs/images/logo-hero.png" height="160" alt="Canary" />
  <p><strong>看清项目检查结果、代码结构和验证证据。</strong><br>
  本地项目检查 · 交互架构地图 · 覆盖与失败定位 · 可追溯重跑</p>
  <p><a href="docs/guides/getting-started.md">快速开始</a> · <a href="docs/guides/support-matrix.md">支持范围</a> · <a href="docs/roadmap/README.md">任务路线</a> · <a href="CONTRIBUTING.md">参与开发</a></p>
</div>

Canary 是面向普通软件项目与 Agent 应用的本地验证工作台。它执行你声明的构建、类型检查和测试，保存原始失败与运行证据，并把项目结构、覆盖率和错误位置放进同一页面。人和编码 Agent 可通过 CLI、报告和现有 MCP 接口读取对应信息。

**当前为 0.1.0 Preview。** 已实现的重点是本地执行、证据和地图；后续方向是现有 CI 上面的变更验证与修复工具。GitHub PR 诊断、隔离复现、同一回归测试的修复前后验证，以及显式行为契约仍属于 [R16–R21 待实施任务](docs/roadmap/13-r16-r21-change-verification.md)。

## 现有能力

- **项目检查：** 显式配置 build、typecheck、lint、test 等命令，输出稳定退出码和 JSON/JUnit/Markdown 报告；还支持文件、进程、HTTP、资源、Docker 状态与 Agent 检查。
- **失败定位：** 查看分类、脱敏日志和可识别的堆栈/源码位置，保留原始失败，再关联修复后的重跑和前后比较。
- **架构地图：** 二维层级与三维分层视图支持搜索、导航、节点详情和上下游过滤。JS/TS 提供精细结构，其他语言支持范围见[支持矩阵](docs/guides/support-matrix.md)。
- **覆盖与证据：** 对已采集且源码匹配的数据显示覆盖分母、未覆盖区域和分支位置；黑盒、未采集及映射不准确部分显示不可用或未知。
- **静态分析：** 显示循环依赖、维护者声明的分层违规和 Git 变更的潜在消费者影响。显式启用增量检查时保留选择理由，信息不足执行全量，省略项不计通过。
- **Agent 评估：** 函数、HTTP 和 MCP 相关适配器支持用例、断言、轨迹、回放及比较；已有经验/Skill 流程采用受控操作。

代码被执行不等于行为有充分断言；同一检查重跑通过也不等于新增回归测试已证明修复前失败、修复后通过。当前结论和未验证边界见[支持矩阵](docs/guides/support-matrix.md)。

## 快速开始

源码安装建议使用 **Node.js 24、Git 和 pnpm 10.15.0**。根运行时声明为 Node ≥22，但当前开发工具链中的 ESLint 10 要求 Node 22.13+ 或 Node 24+；首次安装请使用 Node 24。macOS 和原生 Ubuntu 按计划在开源后补验。

```bash
git clone https://github.com/EVEDensity/Canary.git
cd Canary
pnpm install --frozen-lockfile
pnpm build
pnpm canary run --port 4318 --no-open
```

在浏览器打开 `http://127.0.0.1:4318`。本仓库的计划执行构建、类型检查、lint、格式检查、全仓测试和 Agent 回归；首次运行需等待完成，终端打印实际 runId 和产物目录。只想先看内置 Agent 示例可运行 `pnpm demo`，其数据范围与全仓检查不同。

### 全局命令

从干净的 Canary 源码目录执行：

```bash
node scripts/install-global.mjs
```

安装会构建源码、注册用户级启动器并修改用户 PATH。新开终端后，可在被测项目目录使用 `canary`。这是源码安装方式；更新、固定版本、卸载和排查见[安装与启动](docs/guides/getting-started.md)。

### 接入自己的项目

先准备被测项目的依赖，再在其根目录创建 `canary.project.json`。以下配置适用于 package.json 中已有 `build` 和 `test` 脚本的 Node 项目，请替换为实际检查命令：

```json
{
  "kind": "canary.project",
  "version": 1,
  "checks": [
    {
      "id": "project.build",
      "type": "command",
      "command": "node",
      "args": ["--run", "build"],
      "timeoutMs": 120000
    },
    {
      "id": "project.test",
      "type": "command",
      "command": "node",
      "args": ["--run", "test"],
      "timeoutMs": 120000
    }
  ]
}
```

这里使用 Node 的 `--run` 执行脚本，避免 Windows 的 npm/pnpm `.cmd` 入口无法直接启动。`--run` 不运行 npm 的 pre/post 生命周期；依赖它们的项目需声明完整步骤，或按[检查指南](docs/guides/r4-project-checks.md)使用显式运行时入口。

在被测项目目录执行：

```bash
canary paths --json                  # 核对项目与产物目录
canary doctor --json                 # 检查配置和运行条件
canary run --ci                      # 无页面执行，输出机器结果
canary run --port 4318 --no-open      # 执行并展示本地页面
```

跨目录可用 `canary run --config <配置路径> --port 4318`。默认发现向上查找最近配置，同目录优先 `canary.project.json`；缺配置时提示缺失。Canary 执行显式检查，不自动运行未知项目的全部脚本。更多类型和依赖配置见[项目检查指南](docs/guides/r4-project-checks.md)。

普通 `command` 检查不会自动获得整个项目的代码覆盖率。现有函数 Agent 的 V8 覆盖限于声明范围；HTTP/独立 MCP 黑盒通常无法采集源码覆盖。普通项目 Istanbul/LCOV 导入与差异覆盖属于 R20 计划。

## 报告与地图

运行产物写到**被测项目**的 `.canary/artifacts/<runId>/`，包含检查结果、报告与完整性 manifest；Agent 子运行有独立身份和轨迹。维护测试日志写到本仓库 `.canary/logs/`。

```bash
canary runs
canary report <runId>
canary structure --base HEAD
canary structure --run <runId>
canary impact --base <baseline-commit>
```

页面的“检查与日志”提供原始错误证据，地图提供结构/覆盖/源码下钻，“改进建议”承载现有问题处理和受控 Agent 建议。历史运行读取封存结构；源码无法恢复或核对时显示未知。

完整声明检查输入范围后，可用 `canary run --ci --affected --base <baseline-commit>`。默认全量；增量计划保留执行/省略理由，不承诺普遍提速。见[架构与 CI](docs/guides/architecture-ci.md)。

## 数据与安全

默认确定性检查不需要模型密钥。你配置的命令、Agent、Judge、宿主和工具可以自行访问网络并消耗模型费用。Canary 不提供操作系统安全沙箱，请在可信环境中执行可信项目。

脱敏不能替代分享前检查：日志、源码快照、报告和截图可能包含业务数据与本机路径。将 `.canary/` 加入目标项目忽略规则；密钥通过本地环境或受控凭据方式注入。漏洞报告方式见 [SECURITY.md](SECURITY.md)。

## 支持与后续

Windows/Node 24 是主要本机证据范围。Ubuntu 容器、Pi 和外部项目各有限定的历史结果，不能推导为所有平台或宿主兼容。当前远端 CI 未形成最新版本的通过证据，开源后补验；workflow 存在不代表已通过。

[R16–R21](docs/roadmap/13-r16-r21-change-verification.md) 将补齐公共故障证据、PR 入口、复现、修复有效性、变更验证缺口和统一交付。真实故障数据、独立用户与模型评分校准仍有缺口，状态统一见[任务总表](docs/roadmap/README.md)。

开发和维护见 [CONTRIBUTING.md](CONTRIBUTING.md)。普通问题使用 [Issue 模板](https://github.com/EVEDensity/Canary/issues/new/choose)，提供版本、系统、命令和脱敏复现；安全细节按 SECURITY.md 的渠道处理。

更多文档：[导航](docs/README.md) · [当前架构](docs/current/architecture.md) · [支持矩阵](docs/guides/support-matrix.md) · [Agent 接入](docs/guides/adapters-and-environment.md)。

源码采用 [Apache-2.0](LICENSE)。随包字体保留 OFL，Lucide 图标保留其许可证声明，见对应 assets 与许可证文件。
