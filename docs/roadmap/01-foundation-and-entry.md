# F：基础架构与产品入口

> F-01 到 F-05 已落地到当前代码。责任边界见[总表](README.md)。未接线的 Experiment/授权契约仍不得当作已运行。

<a id="f-01"></a>

## F-01 · 统一项目定位与全局入口

- **依据**：`scripts/install-global.mjs` 启动器使用安装仓库 cwd；`packages/cli/src/home.ts`、`index.ts` 的 run/history 项目选择不统一。产物根实际跟随配置目录。
- **范围**：安装脚本、CLI 路径解析、所有读写产物命令及测试；不先改评估器。
- **交付**：显式区分 invocation/project/config/install/artifact 根；给出优先级；所有命令使用统一 ProjectContext。发布方式先做验证，不假定当前包可 npm 全局安装。
- **验收**：在另一个项目、含空格/中文目录、嵌套目录、显式绝对/相对配置、无配置目录和设置 INIT_CWD/CANARY_HOME 的情况下验证目标不串；run/report/replay/compare 读写同一目标。安装升级不覆盖用户项目。
- **依赖/回滚**：无；保留兼容入口或明确迁移，撤回不移动/删除用户产物。
- **排除**：自动推断任意 Agent 协议、发布未经验证的平台包。

<a id="f-02"></a>

## F-02 · Web 与 headless 生命周期

- **依据**：`runCommandDetailed` 先 listen 后运行，结束才打印/打开页面；headless 仍监听，`web.enabled` 未在该路径生效。
- **范围**：`packages/cli/src/index.ts`、`apps/web/src/index.ts` 的启动/清理和集成测试。
- **交付**：运行前展示地址和 runId；headless 不创建监听；统一 enabled/open/port 的语义；端口占用、启动错误、取消、结束清理有确定状态。
- **验收**：长用例执行期间可看事件；headless 检查无监听/无打开动作；端口冲突有明确退出；服务错误不留下子进程。写 API 不能仅靠 CORS 放行，先鉴权或默认关闭未受控写入口。
- **依赖/回滚**：无；HTTP 接口变更显式兼容，回退不得重新暴露未授权写接口。
- **排除**：UI 视觉重做、远程公网部署、完整进化审批系统。

<a id="f-03"></a>

## F-03 · core 机械拆分与新契约

- **依据**：`packages/core/src/index.ts` 承担大量类型/工具；RFC Phase 1 提议 experiment 等新类型但当前并未形成完整运行链。
- **范围**：core 内聚模块、barrel exports、类型兼容测试；新增契约另一步提交。
- **交付 A**：仅搬迁原有声明/实现，保留导出名和语义，不偷偷重命名 JSON 字段。
- **交付 B**：为 ProjectContext、Experiment/Trial、Metric 状态、提案/授权/激活记录定义最小版本化契约，标记未接入部分；不要预建无消费者的大框架。
- **验收**：所有包编译、现有测试和默认 Demo 保持；旧 import 可用；新增声明不会自动改变默认 run 行为。
- **依赖/回滚**：无；先固定当时基线；每一步独立可回退。
- **排除**：同时重写 Runner、Judge 或改变比较判定。

<a id="f-04"></a>

## F-04 · Trace、产物存储与一致脱敏

- **依据**：`packages/trace/src/index.ts` 的同步 JSONL；CLI 依赖 Web 的 RunStore/FileArtifactRepository；SSE 日志是内存态。当前脱敏没有覆盖所有数据出口。
- **范围**：trace、共享存储端口、Web/CLI 存取边界及旧格式读取器。
- **交付**：schema/version 与 run/trial 关联；异步 sink、背压、flush/close；旧同步 API 兼容层；统一数据分类/脱敏；原始证据与可显示投影分开。可信事件不允许候选覆盖。
- **验收**：旧 trace/artifact 可读；中断写入可恢复且不伪造完成；慢 sink 不无界占内存；输入/输出/错误/报告/UI/SSE 的敏感样本测试；游标持久化能力按实际实现声明，不混淆进程内重连与跨重启恢复。
- **依赖/回滚**：F-03 契约；新写格式版本化并保留旧读，不批量改写旧实验。
- **排除**：强制外部数据库、云遥测或全量 OTel 集成。

<a id="f-05"></a>

## F-05 · Runner 端口与应用服务

- **依据**：`packages/runner/src/index.ts` 内联 worker、直接构造 coverage/evaluator/adapters；CLI 承担编排并依赖 Web 实现类。
- **范围**：Runner 执行器端口、worker 文件、组合根、无 UI 的应用服务；明确 core 只保存契约。
- **交付**：Agent/Tool、Coverage、Evaluator、Artifact/Event/Clock 等必要端口；CLI/Web 调用同一运行用例；HTTP/MCP 与 Node 路径统一取消、超时、预算和完成状态。
- **验收**：并发、case repetition override、取消、子进程树清理、IPC 限制、流式覆盖率、失败退出码、旧产物兼容均保留；headless 不依赖 Web 实现才能运行；外部请求实际终止与“停止等待”分开测试。
- **依赖/回滚**：F-03、存储接入依赖 F-04；先通过兼容 facade 接入，再逐步迁移，旧执行路径可回退。
- **排除**：端口存在不等于真实沙箱；安全隔离由 H-01 验收。
