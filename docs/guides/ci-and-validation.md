# 当前 CI 与验证方式

当前契约和本轮证据分别见 [R0 CLI 契约](r0-cli-contract.md)、[R0 执行记录](../evidence/r0-execution.md)。远端 GitHub CI 不作为本轮必需门槛；未执行的环境不写 verified。

## 本地命令

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
pnpm lint
pnpm format:check
pnpm demo:headless
pnpm verify:r0
```

只运行需要的范围，记录实际退出码。typecheck 当前脚本调用 tsc，不能假设完全不产生编译产物。没有重新安装依赖就不要写“已验证全新安装”。

本轮真实记录、测试分包计数和 Demo 数据见 [验证基线](../evidence/validation-baseline.md)。旧报告中的 14/15 用例、不同测试数量和架构评分属于不同范围，不作为当前验收结论。

## 现有 GitHub Actions

依据：[ci.yml](../../.github/workflows/ci.yml)、[release.yml](../../.github/workflows/release.yml)、[verify-pack](../../scripts/verify-pack.mjs)。

| Job              | 配置中的行为                                          |
| ---------------- | ----------------------------------------------------- |
| format / lint    | 格式检查与 ESLint                                     |
| Node 24          | build、typecheck、test                                |
| coverage fixture | 单独执行 fixture matrix；默认包测试也包含该文件       |
| Demo matrix      | local-agent / mcp-agent / loop-agent 的 headless 示例 |
| Bun smoke        | CLI help smoke；不是 Bun V8 coverage 验证             |
| pack             | 构建并验证 tarball；不等于 npm 已发布                 |

根 engines 声明 Node ≥22，而当前 CI 测试 job 配置 Node 24；不可把 engines 或 workflow 的存在当成多个平台已实测。tag 发布流程及 NPM_TOKEN 配置也不能证明远端发布成功。

## 当前最小人工验收

- 在可信示例上 build 后运行，核对 case 计划、结果、gate、退出码及 artifact 路径。
- 查看 unavailable 和实际覆盖率的区别；不要仅看页面颜色。
- 浏览器交互、Windows/Linux/macOS、真实宿主 Skill/MCP、本地模型、强沙箱和远端部署分别验收，未运行的明确记为未验证。
- 改进草稿与 candidate 的测试通过只能证明现有功能；自动准入需完成 roadmap 的独立测试。

新功能各自的文件范围、测试和回滚条件在 [任务目录](../roadmap/README.md)，不再以旧 Week N 计划安排工作。
