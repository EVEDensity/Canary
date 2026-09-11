# canary MVP 实现验收清单与风险审阅

> 审阅对象：`docs/MVP-ARCHITECTURE-INITIAL-REPORT.md` 及当前 `canary` MVP 实现
>
> 审阅日期：2026-09-12
>
> 审阅范围：Coverage Collector、Runner 子进程生命周期、CLI `canary run`、本地 Web/SSE、coverage fixture 测试
>
> 说明：本文件只记录验收标准、当前证据与风险，不修改核心实现代码。

## 1. 审阅结论

当前仓库仍处于**初始化骨架阶段**，尚未达到初始报表中定义的 MVP 实现验收状态。

最重要的结论：

- `packages/coverage` 当前是接口/占位实现，不是真实 Node/V8 Coverage Collector；
- `packages/runner` 当前没有 execution 子进程生命周期实现；
- `packages/cli` 当前只启动一个文本 HTTP 服务，不具备 `canary run` 完整编排；
- `apps/web` 有静态占位页和 SSE 连接，但没有接入 Run Store、事件广播或实时覆盖率数据；
- 仓库中没有 coverage fixture 测试，因此无法证明分支、函数、异常和未加载文件统计准确；
- 当前不能宣称完成“白盒覆盖率 + 子进程隔离 + 一键运行 + 实时页面”的闭环。

建议当前版本标记为：**Design scaffold / Not yet MVP-ready**。

## 2. 文档要求到实现的追踪矩阵

| 能力 | 文档要求 | 当前实现证据 | 状态 | 主要缺口 |
|---|---|---|---|---|
| Node/V8 覆盖率 | 本地 Node/TypeScript 白盒 Agent；行、语句、函数、分支覆盖率 | `packages/coverage/src/index.ts` 只返回空指标；`instrumentation.ts` 为空 | 未通过 | 需要启动/停止 V8 coverage、Source Map 映射、过滤、合并、计算 |
| Feature Registry | 显式 Feature Registry + 源码范围 + 实时增量 | `feature()` 仅执行 callback，不登记、不记录、不关联源码范围 | 未通过 | 需要 registry、feature event、覆盖率映射和去重 |
| 每 execution 独立采集 | 单用例独立子进程、默认并发 1 | `packages/runner/src/index.ts` 仅 `describeRun()` | 未通过 | 需要 spawn、IPC、watchdog、退出码、清理、失败分类 |
| Runner 生命周期 | timeout、取消、最大步骤、finally 清理 | 未实现 | 未通过 | 父子进程协议、SIGTERM/SIGKILL、僵尸进程防护 |
| Agent 适配 | Function/HTTP/MCP 分层 | 只有类型/占位接口，未被 Runner/CLI 使用 | 未通过 | 统一 adapter contract、加载入口、错误边界 |
| Trace | 结构化 trajectory 与 execution 关联 | `TraceBuffer` 仅内存追加 | 部分 | 缺少持久化、事件 schema、脱敏、实时广播 |
| CLI `canary run` | 一键运行、写 run artifact、打开本地页面 | CLI 仅提供 `startLocalUi()` | 未通过 | 配置加载、case discovery、run orchestration、report、exit code、open |
| 本地 Web UI | 页面保留、Overview/Timeline/Feature Coverage | `apps/web` 为硬编码占位页 | 部分 | Run Store、snapshot API、SSE 事件、覆盖率视图、错误态 |
| SSE | 实时推送事件与覆盖率增量 | `/api/events` 只推送 `web.ready` | 未通过 | 事件总线、历史回放、断线重连、心跳、并发客户端清理 |
| 覆盖率 fixture | 分支、函数、异常、未加载文件 | 未发现相关测试文件 | 未通过 | 至少四类 fixture 与期望值断言 |
| CI/门禁 | typecheck、测试、fixture、build、Demo | pnpm 命令在审阅环境中未在限定时间内返回 | 未验证 | 依赖安装、脚本、Node matrix、失败退出码 |

## 3. 关键验收清单

### 3.1 Coverage Collector

#### P0 必须通过

- [ ] `CoverageSession.start()` 能在 Agent execution 开始前建立采集上下文。
- [ ] Coverage Collector 使用 Node/V8 官方 coverage 能力或等价受支持协议采集真实 execution 数据。
- [ ] execution 结束、超时、异常、被取消时均执行 `stop/finalize`。
- [ ] 采集结果至少包含：source URL、脚本范围、函数、分支/范围、执行次数或等价原始数据。
- [ ] 只统计 `coverage.include` 范围内的 Agent 源文件。
- [ ] 正确排除 `exclude`、`node_modules`、测试文件及 canary 自身源码。
- [ ] TypeScript Source Map 映射失败时不静默伪造结果；应为 `partial` 或明确失败。
- [ ] 结果能区分 `final`、`partial`、`unavailable`，且 UI 与 CLI 使用同一语义。
- [ ] 空集、未加载脚本、加载但未执行脚本不会被错误地报告为 100%。
- [ ] lines/statements/functions/branches 的分母和分子定义固定，并有测试覆盖。
- [ ] coverage 结果包含 Node 版本、采集器版本、配置 hash/source hash，支持可复核。
- [ ] 多 execution 合并时不会重复计算同一 script/function/branch。

#### P1 建议通过

- [ ] 支持 raw V8 artifact 保存，便于调试映射问题。
- [ ] 支持 coverage 增量事件，但最终结果仍以 finalize artifact 为准。
- [ ] 对非法 source map、匿名脚本、动态 eval 有显式分类。
- [ ] 对 worker/child process 的不支持范围在报告中明确显示。

### 3.2 Feature Coverage

- [ ] `feature(featureId, operation)` 能登记 feature metadata，而不仅是执行 callback。
- [ ] feature 事件至少包含 featureId、executionId、caseId、开始/结束时间、状态。
- [ ] feature 与源码范围或可验证链路存在稳定关联；不能只根据字符串命名推断覆盖率。
- [ ] 同一 feature 多次触达有去重和次数语义。
- [ ] feature 未触达、触达但失败、触达且通过三种状态可区分。
- [ ] Feature Coverage 与代码覆盖率在 API 和 UI 中分开展示。
- [ ] feature 映射变更会改变 manifest/source hash，避免历史数据误合并。

### 3.3 Runner 子进程生命周期

#### 启动

- [ ] 每个 case/repetition 默认拥有独立 executionId 和子进程。
- [ ] 子进程获得明确的 input、case 配置、coverage 参数、trace 位置和 IPC 端点。
- [ ] 父进程不直接把用户 Agent 代码加载进 CLI 进程，避免污染 CLI coverage。
- [ ] 子进程入口支持编译后的 JS 与明确的 TypeScript 开发模式，不依赖 Node 直接执行 `.ts` 的隐式行为。

#### 运行

- [ ] 父进程能接收 started、trace、coverage-progress、completed、failed、exited 事件。
- [ ] IPC 消息有 schema 校验、版本字段和最大消息大小。
- [ ] 同步死循环可由父进程 watchdog 终止。
- [ ] 异步挂起、工具超时和 Promise 不结束均能按 timeout 分类。
- [ ] 超时先优雅终止，再在宽限期后强制终止。
- [ ] 取消操作可以传递到子进程，并最终清理进程树。
- [ ] 子进程非 0 退出码、signal、uncaught exception、unhandled rejection 都有稳定 failureCategory。

#### 收尾

- [ ] 正常完成、异常、超时、取消路径都执行临时目录与资源清理。
- [ ] 不产生孤儿进程、未关闭 server、未关闭 MCP client 或文件句柄。
- [ ] 父进程只在 artifact 写完、状态落盘后结束。
- [ ] execution 状态不可从 failed 被错误覆盖为 passed。
- [ ] 重复运行不会复用上一次的内存状态或 trace buffer。

### 3.4 CLI `canary run`

- [ ] 从当前工作目录加载 `canary.config.ts`，路径解析相对于配置文件而非进程 cwd。
- [ ] 支持明确的 headless/interactive 两种模式。
- [ ] interactive 模式启动 Web server，并输出可访问 URL。
- [ ] `open: true` 时只打开本地页面，不把 URL 或数据发送到外部服务。
- [ ] 自动发现 smoke/regression/holdout，并能按标签或路径过滤。
- [ ] 运行前校验配置、Agent entry、case 数据和 coverage include。
- [ ] 运行中持续写入 `.canary/runs/<runId>/`，而不是仅在进程结束后生成结果。
- [ ] 结束后生成 summary、trajectory、coverage、report artifact。
- [ ] 任一 P0 门禁失败时 CLI 以非 0 退出；交互 UI 仍保留并可查看失败。
- [ ] `--case`、`--tag`、`--repetitions`、`--headless`、`--no-open` 等参数行为有测试。
- [ ] Ctrl+C 能停止运行并生成 cancelled/partial artifact。

### 3.5 Web Run Store 与 SSE

#### Run Store

- [ ] Run Store 是唯一的运行状态来源；CLI、SSE、页面 snapshot 不各自维护副本。
- [ ] 至少保存 run metadata、case status、trajectory events、coverage snapshot、eval result、error。
- [ ] 状态更新具有单调版本号或 event sequence，客户端可检测丢事件。
- [ ] 页面首次连接能通过 snapshot 获取已发生事件，而不是只等待未来事件。
- [ ] run 完成后重新打开页面仍能看到最终结果。

#### SSE

- [ ] 事件类型固定并版本化，例如 `run.started`、`case.started`、`trace.event`、`coverage.updated`、`case.completed`、`run.completed`、`run.failed`。
- [ ] SSE 数据包含 `id`，支持 `Last-Event-ID` 或等价断线恢复。
- [ ] 建立心跳，避免代理/浏览器误判连接断开。
- [ ] 客户端断开后服务端释放 response listener。
- [ ] 多个浏览器客户端能同时收到同一 run 的事件。
- [ ] 完成事件之后不再接受普通事件；重复完成应被拒绝或幂等处理。
- [ ] 服务错误以结构化事件和 HTTP 状态返回，不输出未脱敏异常栈。

#### UI

- [ ] Overview 同时显示 task success、code coverage、feature coverage，不合并成单一分数。
- [ ] Coverage 页面显示 lines/statements/functions/branches 的 covered、total、percentage、status。
- [ ] Feature 页面显示未触达 feature 和对应用例/轨迹。
- [ ] Timeline 能展示 tool/agent/error/state/coverage 事件。
- [ ] running、completed、failed、partial、cancelled、unavailable 状态有视觉区分。
- [ ] 未采集覆盖率时显示 `unavailable` 原因，而不是 `0%` 或 `100%`。
- [ ] 页面在无 JS、SSE 断线、run 尚未开始、run 已结束时有可理解的 fallback。

### 3.6 Coverage Fixture 测试

至少创建以下 fixture，且测试必须断言数值和状态，而不是只断言“有输出”：

1. **分支 fixture**：if/else 或 switch，分别执行一条和两条路径，验证 branch covered/total。
2. **函数 fixture**：多个函数，其中一个未调用，验证 function covered/total。
3. **异常 fixture**：成功路径、throw 路径、catch/finally 路径，验证异常执行不会丢失 finalized coverage。
4. **未加载文件 fixture**：include 范围内但从未 import 的文件，验证其是否按产品定义进入分母；必须固定一种语义并写入报告。
5. **Source Map fixture**：TS 源文件编译后执行，验证报告指向 `.ts` 而非仅 `.js`。
6. **过滤 fixture**：include 外、exclude 内、node_modules 文件不进入统计。
7. **execution 隔离 fixture**：两个 case 分别执行不同路径，合并结果与单次结果符合定义，且没有跨 run 污染。
8. **异常收尾 fixture**：Agent 抛异常、超时、被取消后仍有 partial/final coverage artifact。

建议使用确定的 expected matrix：

```text
fixture                lines  statements  functions  branches  status
branch-none               ...       ...         ...        ...    final
branch-both               ...       ...         ...        ...    final
function-partial          ...       ...         ...        ...    final
throw-and-catch           ...       ...         ...        ...    final/partial
unloaded-included         ...       ...         ...        ...    final
excluded                  ...       ...         ...        ...    final
```

### 3.7 CLI/Web 集成验收

- [ ] 使用一个本地、无外部 API 的 Agent fixture 完成端到端运行。
- [ ] `canary run --headless` 可在 CI 中完成并返回正确退出码。
- [ ] `canary run` 在交互模式下可访问页面，并在页面中看到同一次 run 的实时事件。
- [ ] 页面刷新后可以通过 run snapshot 恢复状态。
- [ ] 运行结束后覆盖率数字与 CLI JSON artifact 完全一致。
- [ ] case 失败时页面、JSON、JUnit 的 pass/fail 一致。
- [ ] UI 不会把 canary 自身源码 coverage 混入 Agent coverage。
- [ ] run 目录可被复制到另一台同版本 Node 环境进行 replay 或诊断。

## 4. 当前最高优先级风险

### R1：核心能力仍是占位实现（阻塞发布）

Coverage、Runner、CLI、SSE、fixture test 均缺少可运行闭环。这不是边界问题，而是功能缺失。若直接发布，README 和文档会形成过度承诺。

**处置：** 在实现完成前把版本标为 scaffold；CI 不得使用“coverage passed”等措辞。

### R2：coverage 语义未冻结

Node/V8 原始 coverage、Source Map、未加载文件是否进入分母、branch 的定义会直接影响百分比。若先做 UI 后冻结语义，后续结果会不可比。

**处置：** 先写 fixture expected matrix，再实现 collector；把算法版本和 config/source hash 写入 artifact。

### R3：TypeScript 执行方式可能失真

Node 24 是否能直接运行当前 `.ts` 入口、TypeScript path alias 是否能在子进程中解析、Source Map 是否正确，不能靠开发机偶然行为判断。

**处置：** 固定编译/加载策略；优先执行编译后的 ESM；开发模式明确使用受支持 loader 或 bundler；在 Node 22/24 CI 验证。

### R4：子进程不是安全沙盒

`spawn` 只提供隔离和可终止性，不阻止 Agent 读取本机文件、使用网络或泄露环境变量。

**处置：** 文档明确警告；默认清理敏感环境变量；真实不可信代码后续使用容器或专用 sandbox。

### R5：同步死循环可能阻塞父进程观测

如果 Agent 在子进程中同步占满 CPU，SSE 只能显示“running”，不能依靠应用层协议恢复。

**处置：** 父进程 watchdog + process tree kill；测试 busy-loop fixture；记录 `loop_detected` 或 `timeout` 的准确语义。

### R6：SSE 只是连接，不是实时数据系统

当前 `/api/events` 发送 `web.ready` 不代表 run 事件可达。没有 Run Store 和事件序列，页面刷新与断线恢复都会丢数据。

**处置：** 先定义事件 schema、sequence 和 snapshot，再实现 SSE；用多客户端和断线测试验收。

### R7：覆盖率和 Agent 行为指标混淆

高代码覆盖率不代表任务完成，高 task success 也不代表覆盖充分。

**处置：** UI、JSON、Markdown 均显示三个独立维度，并在文档中保留语义说明。

### R8：异常/超时路径丢失 coverage

Collector 未在 finally 或父子进程协议的终止阶段 finalize 时，失败用例会完全丢失证据。

**处置：** 为 throw、timeout、cancel、non-zero exit 分别写 artifact 断言。

### R9：跨平台进程与路径差异

Windows 下 signal、进程树终止、路径分隔符、浏览器打开命令、端口占用与 POSIX 不同。

**处置：** 当前目标环境先做 Windows smoke，再补 Linux/macOS CI；禁止依赖 shell 字符串拼接启动 Agent。

### R10：敏感数据写入 trace/artifact

输入、工具参数、模型输出和环境变量可能包含 token、个人信息或业务数据。

**处置：** 默认本地落盘、字段脱敏、大小限制、外发关闭；文档写明 artifact 删除方式。

## 5. 建议的验收顺序

1. 冻结 coverage 语义和 fixture expected matrix；
2. 实现并通过 collector 单元测试；
3. 实现 runner 子进程与异常/超时/取消测试；
4. 接入 trace 与 Run Store；
5. 完成 CLI headless 端到端；
6. 接入 Web snapshot + SSE；
7. 做交互模式、刷新、断线、多客户端验收；
8. 最后做 CI、Node 版本矩阵和文档口径审查。

## 6. 发布前阻塞项

以下任一项未通过，不建议称为 MVP ready：

- [ ] 覆盖率 fixture 全部通过；
- [ ] 至少一条真实 TS Agent 的 end-to-end run 通过；
- [ ] Agent 异常、超时、取消均有可读 artifact；
- [ ] CLI headless 与 interactive 结果一致；
- [ ] 页面能展示同一次运行的实时 trace 和 coverage 更新；
- [ ] 页面刷新后能恢复已完成 run；
- [ ] coverage unavailable/partial 语义正确；
- [ ] Windows 基础流程通过；
- [ ] CI typecheck、test、build、fixture 和 smoke demo 通过；
- [ ] README 不再把占位能力描述成已实现能力。

## 7. 不应修改的核心实现边界

本审阅要求不改变核心实现代码。后续开发可以新增测试、fixture、artifact schema 和审阅文档，但任何实现修改应另开变更并重新执行本清单。
