# 仓库结构

Canary 采用 pnpm 工作区组织应用与核心模块。根目录保留产品入口、许可证、项目验证配置和工具链配置。

```text
Canary/
├── apps/web/               # 交互式报告与架构地图
├── apps/site/              # 中英文产品展示页与 GitHub Pages 构建
├── packages/               # CLI、执行、评估、覆盖率、证据与控制模块
├── examples/               # 可运行示例及其用例
│   └── local-agent/cases/  # smoke、regression、holdout
├── integrations/           # 外部项目接入配置与平台 fixture
├── scripts/                # 构建、安装与验收工具
│   └── install/            # Windows、macOS/Linux 安装与卸载入口
├── docs/                   # 指南、架构、路线与精简证据
├── .github/                # 工作流、反馈模板和 CODEOWNERS
├── .changeset/             # 版本发布配置
├── canary.project.json     # Canary 自身项目检查计划
└── canary.config.ts        # 示例 Agent 回归配置
```

## 文件放置规则

- 产品源码归入 `apps/` 或对应 `packages/`，各模块保留自己的测试。
- 示例输入与用例放在对应 `examples/<示例>/`，由配置显式加载。
- 外部接入配置放在 `integrations/`；通用验收工具放在 `scripts/`。
- 使用指南放在 `docs/guides/`，当前架构放在 `docs/current/`，任务进度放在 `docs/roadmap/`。
- 文档中保留阶段摘要和必要的结构化结果；原始日志与运行产物写入 `.canary/`，由 Git 忽略。
- `package.json`、锁文件、workspace、TypeScript、ESLint、格式和 Git 配置保留根目录，便于工具自动发现。

## 本次整理

已将四个安装／卸载脚本归入 `scripts/install/`，CODEOWNERS 归入 `.github/`，三份示例用例归入 `examples/local-agent/cases/`，同步更新配置、导入和安装文档。

38 个 `.canary/` 文件退出提交范围，原有运行历史保留。98 份历史文本日志归档并保留哈希索引，详见[归档说明](../evidence/logs/README.md)。日常运行不需要仓库预置 `.canary/`，所需目录由程序自动建立。

整理后构建、类型检查、lint 和文档格式检查通过；34 项 CLI 相关测试通过。迁移后的 Agent 套件实际运行通过 15/15 个用例、45/45 项断言（`run_8447d717-3df7-4ea6-8864-d58c16426c42`）。安装脚本同时修正了 PowerShell 注释起始符和 shell 文件的 BOM，四个帮助入口通过执行验证。
