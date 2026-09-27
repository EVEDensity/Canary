# R9-00 / R9-01 交付与外部接入记录

日期：2026-09-25（Asia/Shanghai）；环境：Windows 11、Node 24.18.0、pnpm 10.15.0、Python 3.12.10。R8 已提交的起点为 `4fdb24d84f20496874bc308b6218fd4eda4759f8`；R9 改动包含 HTTP `agent.requestField` 和三个公开项目试点配置。固定交付 commit 与干净 checkout 复核记录在本文件末尾。无模型调用；两个 HTTP 服务均使用上游 MockProvider。

## R9-01：三个真实上游项目

所选项目均为公开仓库，使用固定 commit 和原生依赖安装；试点配置保存在[仓库内](../../integrations/r9-external/README.md)，第三方源码保留在被忽略的 `.canary/verification/r9/external/`。`git status` 核对上游已跟踪文件无修改，新增的仅为 Canary 配置、MCP 接入文件和 `.canary` 产物。

| 类型                  | 上游及固定 commit                                                                                                                           | Canary 项目检查                                          | 首份报告开始时间（UTC） | CLI 耗时 | 本地接入文件 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------- | -------- | ------------ |
| Node/TypeScript Agent | [typed-agent-service](https://github.com/jkelly-dev1/typed-agent-service) `7ea9fc95cd56ee40bf7988c4e949e1696322edc1`                        | 上游 69 项测试；MockProvider 的计算器工具 HTTP 用例      | 2026-09-24 17:09:30     | 7.7 秒   | 3 个         |
| Python HTTP Agent     | [ai-coding-agent](https://github.com/goktugparlak/ai-coding-agent) `291968f41f6099882f0c54dceda12da982cd3fd6`                               | 上游 15 项 pytest；MockProvider 的 `/api/chat` HTTP 用例 | 2026-09-24 17:11:11     | 5.5 秒   | 3 个         |
| MCP 工具              | [官方 Everything 服务](https://github.com/modelcontextprotocol/servers/tree/main/src/everything) `f46d9578190b476b3501923ea8977d899e8db2cb` | 上游 109 项 Vitest；stdio `get-sum(2,3)` 工具用例        | 2026-09-24 17:09:30     | 6.5 秒   | 4 个         |

执行顺序：克隆上游 → 安装依赖与构建 → 在副本中放入接入文件 → 启动两个回环 HTTP 服务 → 从各自项目根运行全局 `canary run --ci` → `canary verify <runId> --json`。开始时间来自父项目 `run.json`，各取到秒。这三个耗时是**依赖、配置、服务准备完成后的 CLI 运行耗时**，不包含克隆、安装、理解接口、写配置或服务启动，因此不能宣称陌生用户已经达到“15 分钟内接入”。配置创建时间至首次项目运行开始约 1.4 分钟，仍不是完整首次使用计时。R9-05 应由外部试用者独立计时。

配置改动口径：三个上游仓库的已跟踪文件修改均为 **0**；试点新增 Canary 接入文件分别为 3、3、4 个。Python 配置在成功后又有 1 次已记录的本地解释器路径修订（绝对路径改为 Windows 项目相对路径），并重新运行得到下表的最终报告。首次成功前的探索性编辑没有独立事件日志，因此“配置修改次数”的完整历史 **未知**；不能将新增文件数冒充编辑轮数。这是后续独立接入计时必须补采的指标。

| 项目       | 父项目 runId                               | 结果                          | 父 manifest SHA-256                                                |
| ---------- | ------------------------------------------ | ----------------------------- | ------------------------------------------------------------------ |
| TypeScript | `run_0ace8aac-16b1-415b-afa1-a340d5406551` | 2/2 passed；verify `verified` | `d43af8f99a15fd053debb632017c1fed5b48109d9f2a9ace7fbd977da06c8da4` |
| Python     | `run_7a4cf6a4-52d7-46e8-904c-99e8120a8ac6` | 2/2 passed；verify `verified` | `e2ffe25608a060f6c9a55003c01919855c70079fff59bc56dfce1bf0e6c7b29a` |
| MCP        | `run_d05886f0-d030-4cf2-abd3-928d49b8a9a0` | 2/2 passed；verify `verified` | `4e3fe80cd9a33be5e61e50727ce6b35621c5206b01891865c68a5ad367010fe3` |

父项目运行各含原生测试和真实 Agent/工具子运行，父记录保存子 runId 与 manifest 哈希。原始 `checks.json`、子运行 `run.json` 和完整 manifest 位于各被测副本的 `.canary/artifacts/`；它们不进入 Canary Git 历史。

## 接入障碍与修正

1. 两个 HTTP 服务都接收 `{ "message": ... }`，Canary 旧接口固定发送 `{ "input": ... }`。新增 `agent.requestField`，默认仍为 `input`，只允许简单顶层标识符；真实 HTTP 子运行已核对计算器调用和 Python 响应。HTTP 源码覆盖率保持 `unavailable`。
2. TypeScript 和 Python 服务需要单独启动，项目检查当前不托管长期运行服务。试点使用 `127.0.0.1:4329` 与 `127.0.0.1:4330`；端口或服务不可用时 Agent 检查会失败。Python 项目检查调用本地 `.venv/Scripts/python.exe`，该配置目前针对 Windows。
3. MCP Everything 提供工具 `get-sum`，Canary 的 `agent.adapter: "mcp"` 固定调用 `run` 工具，因此新增 4 行函数 Agent 接线，通过 `tools.adapter: "mcp-stdio"` 调用真实服务。Canary 显示的 100% V8 覆盖率只属于接线文件，不能表示上游服务覆盖率。上游独立 Vitest 报告的行覆盖率为 60.79%（504/829），分母和采集器不同。
4. MCP 首次 `npm ci` 遇到一次 `ECONNRESET`，使用同一上游锁文件、限制为 Everything workspace 后重试通过；Python pip 一次下载读超时后自动重试成功。这些是准备期网络障碍，未计入 CLI 耗时。

三项均是单机、单次、确定性试点。它们验证接入与工具行为，没有覆盖真实模型质量、一般 MCP 互操作、独立用户上手或持续运行。

## R9-00：交付复核

README、[支持矩阵](../guides/support-matrix.md)、[启动指南](../guides/getting-started.md)、[适配器指南](../guides/adapters-and-environment.md)、[路线图总表](../roadmap/README.md)和 R8 历史记录已经统一到当前范围。R8 已提交起点为 `4fdb24d84f20496874bc308b6218fd4eda4759f8`；本次**代码与试点配置基线**为 `0e9ac44d38e4068dc57e2e2c9638d15e09c313e3`。本执行记录的文档提交在该代码基线之后，最终 HEAD 以 Git 历史为准。

在独立目录 `C:\Users\temp-admin\Desktop\Canary-r9-clean-20260925` 从上述代码基线做干净 checkout，并在 Windows 11、Node 24.18.0、pnpm 10.15.0 下运行：

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm check
pnpm verify:r8
git status --short
```

四项命令均退出 0；`pnpm check` 包含类型检查、全部工作区测试、ESLint 和 Prettier 检查，CLI 集成测试 15 个文件、135 项全过；R8 固定 fixture 的失败→候选→离线回放→批准→实际加载→精确回滚闭环 1 项通过；checkout 的 Git 跟踪树保持干净。日志保存在该独立目录的 `.canary/r9-clean-install-final.log`、`r9-clean-build-final.log`、`r9-clean-check-final.log` 以及 `.canary/logs/verification/r8/`，均为被忽略的验证产物。首次从零安装和构建也已在该独立目录通过；最后一次 frozen install 用于确认固定基线仍可重建。

初期还试过位于深层 `.canary/verification/r9/clean-checkout-final` 的检出；它在资源繁忙时出现多个 Vitest 默认 5 秒超时。普通路径的首次完整检查仅有 Docker 能力探测测试在 5 秒限制下超时。随后给真实会调用宿主能力探测的两个用例设置 15 秒测试时限，并对另外两个子进程异步时序用例增加显式等待；以上均只调整测试同步和超时，未更改产品行为。最终以普通长度的独立检出完整通过作为交付结论；深路径高负载表现仍是未覆盖的环境限制。
