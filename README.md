<div align="center">
  <img src="docs/images/logo-hero.png" height="150" alt="Canary" />
  <h3>看清项目结构，定位失败，验证每一次修复。</h3>
  <p>项目检查 · 交互式架构地图 · 覆盖率分析 · 可追溯证据</p>
  <p><strong>简体中文</strong> · <a href="README.en.md">English</a></p>
  <p><a href="#快速开始">快速开始</a> · <a href="docs/README.md">文档</a> · <a href="docs/roadmap/README.md">路线图</a> · <a href="https://github.com/EVEDensity/Canary/issues/new/choose">反馈问题</a></p>
  <p><a href="LICENSE">Apache-2.0</a> · Node.js 24 推荐 · pnpm 10.15.0</p>
</div>

**Canary 是面向开发者与编码 Agent 的项目验证工作台。** 将检查、架构、覆盖率和错误证据放在一起，从一次失败进入具体代码，再追踪修复后的验证结果。通过 CLI、稳定退出码与标准报告接入现有 CI。

## 核心能力

- **统一检查** — 运行构建、类型检查、lint、测试与 Agent 用例，导出 JSON、JUnit 和 Markdown 报告。
- **架构地图** — 在二维结构与三维分层视图中探索模块、文件和符号，搜索节点、过滤依赖、查看源码。
- **失败诊断** — 查看问题分类、脱敏日志和源码位置，关联原始失败、修复后重跑与前后比较。
- **覆盖率联动** — 将采集到的行、函数与分支覆盖映射到结构节点，定位未覆盖范围。
- **可信证据** — 用 manifest、内容哈希和运行谱系关联代码版本、检查结果与历史记录。

了解[支持范围](docs/guides/support-matrix.md)与[真实验证记录](docs/evidence/2026-09-30-product-verification.md)。

## 快速开始

准备 **Node.js 24、Git 和 pnpm 10.15.0**：

```bash
git clone https://github.com/EVEDensity/Canary.git
cd Canary
pnpm install --frozen-lockfile
pnpm build
pnpm canary run --port 4318 --no-open
```

打开 [localhost:4318](http://127.0.0.1:4318)，查看实时检查、项目地图和运行历史。界面支持中英文切换，并记住语言偏好。

仓库内置六项项目检查；`pnpm demo` 可运行 Agent 评估示例。

## 接入自己的项目

在干净的 Canary 源码目录执行 `node scripts/install-global.mjs`，新开终端即可使用 `canary`。

准备被测项目的依赖，在其根目录添加 `canary.project.json`。以下示例执行已有的 `build` 与 `test` 脚本：

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

在被测项目目录运行：

```bash
canary doctor --json             # 检查配置与运行条件
canary run --ci                  # 在 CI 中执行检查
canary run --port 4318 --no-open  # 执行并展示交互式报告
```

检查按项目配置执行。覆盖率需配置相应采集方式；运行产物保存于被测项目的 `.canary/`，请将其加入 `.gitignore`。

## 文档与参与

- [安装与启动](docs/guides/getting-started.md) · [项目检查](docs/guides/r4-project-checks.md)
- [评估与覆盖率](docs/guides/evaluation-and-coverage.md) · [架构与 CI](docs/guides/architecture-ci.md)
- [Agent 接入](docs/guides/adapters-and-environment.md) · [目录结构](docs/guides/repository-layout.md)
- [贡献指南](CONTRIBUTING.md) · [翻译贡献](docs/guides/localization.md) · [安全政策](SECURITY.md)

新增语言：`pnpm i18n:add <locale>` 创建草稿，`pnpm i18n:check` 校验翻译契约。审核并合并完整资源后，语言自动出现在界面菜单中。

欢迎提交 Issue、改进文档或贡献代码。下一阶段聚焦 PR 诊断、修复验证与变更验证缺口，详见[路线图](docs/roadmap/README.md)。

## 许可证

[Apache-2.0](LICENSE)。随包字体与图标保留各自许可证声明。
