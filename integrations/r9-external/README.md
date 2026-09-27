# R9 外部项目试点配置

本目录保存三个公开上游项目的 Canary 接入配置。它们是可复现的试点材料，不复制第三方源码。固定上游 commit、实际运行结果和局限见 [R9 执行记录](../../docs/evidence/r9-00-01-execution.md)。

## 使用范围

- `ts-agent/`：复制到 `jkelly-dev1/typed-agent-service` 仓库根。`npm ci` 后以 MockProvider 在 `127.0.0.1:4329` 启动服务，再运行 `canary run --ci`。两项检查分别运行上游测试和一次真实 HTTP Agent 用例。
- `python-http/`：复制到 `goktugparlak/ai-coding-agent` 仓库根。建立 Windows `.venv` 并安装 `requirements.txt`，以 MockProvider 在 `127.0.0.1:4330` 启动 Uvicorn，再运行 `canary run --ci`。项目检查中的 Python 路径为 Windows `.venv/Scripts/python.exe`；其他平台需调整该命令。
- `mcp-everything/`：复制到 `modelcontextprotocol/servers/src/everything/`。从上游仓库根执行 `npm ci --workspace @modelcontextprotocol/server-everything`，在 Everything 目录执行 `npm run build` 和 `canary run --ci`。`canary-agent.mjs` 仅把一个 Canary case 转成上游 `get-sum` 工具调用。

三个配置均以 `.canary/artifacts/<runId>/` 保存报告和 manifest；`canary verify <runId> --json` 校验完整性。项目检查完成时间不包括克隆、安装依赖、启动服务和手动理解上游接口的时间。

TS/Python 服务使用确定性 MockProvider，模型调用数为 0。HTTP 黑盒的源码覆盖率为 `unavailable`。MCP case 的 V8 覆盖率只覆盖接入用的 `canary-agent.mjs`，不能视作上游 Everything 服务的覆盖率；上游自己的 Vitest 报告另行提供覆盖率。

这些项目都是第三方代码，接入配置仅用于受信任的本地试点。配置只新增 Canary 文件，上游已跟踪源码未修改。
