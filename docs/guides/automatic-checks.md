# 自动项目检查

全局安装后，在项目目录或任意子目录执行 `canary run --ci`，即可识别并运行项目已有的检查，不需要创建 Canary 配置。使用 `canary run --port 4318` 展示同一套检查的交互式报告；从其他目录可传入 `--project <目录>`。

## 识别规则

- Node：读取 `package.json`，按构建、类型检查、lint、格式检查、测试顺序执行已有脚本。测试优先 `test:ci`、`test:run`、`test`；无总测试脚本时选择 `test:unit`、`test:integration`、`test:e2e`。不自动运行开发服务、部署、修复或 watch 脚本。
- 包管理器：优先读取 `packageManager`，其次读取 pnpm、Yarn、Bun 锁文件，默认 npm。保留包管理器的 pre/post 生命周期，设置 `CI=true`。
- Workspace：优先根目录脚本；根目录没有检查脚本时，根据声明的 workspace 成员读取子包脚本，不扫描执行无关示例。
- Python：识别 `pyproject.toml`、`setup.py`、`requirements.txt`。声明 pytest 时执行 `python -m pytest`，否则发现并执行 unittest；零 unittest 用例不会判为通过。优先项目 `.venv` / `venv` 解释器。
- Go：识别 `go.mod`，执行 `go vet ./...` 与 `go test ./...`。
- Rust：识别 `Cargo.toml`，执行 `cargo check --all-targets` 与 `cargo test --all-targets`。

每项默认最多五分钟。自动发现无法读取有效声明、没有可执行检查或工具不可用时，返回失败或阻塞结果；不会将发现项目或生成架构图当作测试通过。检查是否覆盖业务行为，以实际执行的测试与断言为准。

## 目录与优先级

显式 `--config` 优先，其次为最近的 `canary.project.json` / `canary.config.ts`；没有 Canary 配置时自动定位项目标记及 workspace 根。向上查找不会越过 Git 根或 `.canary` 边界。安装目录不会成为被测项目的默认回退。

```bash
canary run --ci --project /path/to/project
canary run --project /path/to/project --port 4318 --no-open
canary run --ci --config /path/to/custom/canary.project.json
```

自动计划在内存中生成，不修改项目配置。准确的命令、工作目录、配置哈希和结果保存于被测项目 `.canary/artifacts/<runId>/`，包括 `check-plan.json`、`discovery.json`、标准报告与完整性 manifest。页面重跑沿用封存计划；新一轮普通运行会重新读取当前项目声明。

安装器获取源码并准备固定版本的构建工具；没有指定版本的 pnpm 时，通过 npm exec 准备固定构建环境，不要求用户另外配置 pnpm。项目自身依赖、语言运行时与测试服务使用项目已有的环境。自动检查不调用模型，也不会自动安装项目依赖、生成测试或启动外部服务。

高级检查、Agent 适配器、覆盖率采集和自定义环境允许列表仍可使用[项目检查配置](r4-project-checks.md)。自动检测执行已有验证步骤，覆盖率按实际采集的产物展示。
