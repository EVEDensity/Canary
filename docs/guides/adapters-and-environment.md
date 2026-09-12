# 当前 Agent、工具与环境接入

> 依据：[Core 配置](../../packages/core/src/index.ts)、[Runner](../../packages/runner/src/index.ts)、[Adapters](../../packages/adapters/src/index.ts)、[Environment](../../packages/environment/src/index.ts)。只接入可信项目。

## 三种被测 Agent

| `agent.adapter` | entry 与交互                                             | 当前覆盖率                                          |
| --------------- | -------------------------------------------------------- | --------------------------------------------------- |
| `function`      | 本地 TS/JS 模块路径，export 可指定；在 Node 子进程内调用 | include 命中的本地源码可采集 V8 或显式选用 Istanbul |
| `http`          | URL，POST JSON `{ input }`，返回 JSON                    | unavailable，不获取远端内部执行证据                 |
| `mcp`           | 本地 stdio server 模块，调用 `tools/call` 的 `run` 工具  | unavailable                                         |

Function Agent 的 context 提供 emit、tools、state、model 等由 Runner 组装的能力；参考现有 [local-agent](../../examples/local-agent/src/agent.ts)，不要把 AgentAdapter 的简化类型当成所有 worker context 的完整契约。model 当前为 deterministic/echo，不是 LLM Judge。

`mcp-http` 是 **ToolAdapter** 选项，不是第四种 `agent.adapter`；当前 Runner 没有 MCP HTTP Agent 分支。

## 工具与状态

- `tools.adapter` 可选 mock / mcp-stdio / mcp-http；Agent 通过 `ctx.tools.call` 使用，配置与 Agent adapter 独立。
- MemoryStateStore 支持 get/set/snapshot/restore/reset；snapshot 仅覆盖它管理的内存值，不能撤销真实 HTTP 写入、文件修改或生产数据库操作。
- Case 的 environment.state 可作为初始状态；不把类型里的所有可选字段都当成 Runner 已消费，接入前核对具体路径。
- Function 执行有子进程生命周期控制，但不是沙箱；配置、用例与断言仍可能在宿主执行。不要在当前实现中运行不可信仓库或生产凭据。

## MCP 的准确边界

当前 stdio 实现直接发送 JSON-RPC tools/call；HTTP 工具实现 POST JSON-RPC 并解析 JSON 或 SSE body，代码已明确不是完整 Streamable HTTP session 实现。不能把 Demo 通过当成与任意 MCP server 兼容。

后续协议改造必须明确锁定版本：2025-11-25 与 2026-07-28 的生命周期/协商机制有差异，不能统一写成“所有 MCP 都先 initialize”。核对依据见 [研究资料](../research/agent-evolution.md)。

当前方向是 **Canary 调用 MCP Agent/工具**；未来宿主通过 Canary MCP Server 获取证据、提交候选是反向集成，尚未实现。`/canary` 也不是本包自动提供的通用宿主命令。
