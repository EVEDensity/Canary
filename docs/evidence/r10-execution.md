# R10 执行与验收记录

日期：2026-09-25。基线：`bd8262a`。范围：Windows、Node `v24.18.0`、pnpm `10.15.0`，本地仓库与固定临时项目 fixture。

## 交付

- `@canary/structure` 生成带稳定 ID、内容哈希、Git 来源、层级、静态关系、显式未知关系的单一结构快照，支持用户分层和基线变更。
- 项目与 Agent 运行在执行前保存结构，`--base` 同时保存变更；manifest 封存。历史读取校验 manifest，缺快照或损坏时拒绝使用当前源码替代。
- CLI `canary structure`、页面 `/api/structure` 和 MCP `canary.structure` 读取同一格式；页面包含结构概览与变化列表。覆盖结果通过源文件哈希关联结构节点，哈希不符时不展示对应未覆盖位置。

## 验证

结构 fixture 覆盖应用/包/目录/函数/类、显式分层、TS `.js` 路径映射到 `.ts`、本地调用、Python AST、Git 增改删和未暂存精确重命名、覆盖源文件不匹配、非法规则与非法 ref。CLI 集成 fixture 运行真实项目检查并封存结构，之后修改源码仍读到原快照，篡改后校验失败。MCP 测试覆盖分页读取和非法路径。页面 API 测试覆盖已封存快照与损坏拒绝。

执行结果：`pnpm -r --if-present build`、`pnpm check` 均通过；随后新增的一致性保护通过结构 6/6、Web 15/15、CLI 2/2、MCP 9/9 定向测试以及全仓 typecheck、lint、format check。真实仓库执行 `canary structure --config canary.project.json --base HEAD`，生成 1,343 个节点、4,779 条已确认边、196 条显式未知记录，覆盖 327 个扫描文件，并发现 34 项相对 HEAD 的工作树变更。独立扫描约 3 至 4 秒；该数字只代表本轮代码工作树，不是跨项目性能承诺。

原始运行日志保留在 `.canary/logs/r10-*.log`；结构 JSON 在 `.canary/logs/r10-structure-live.json`，均不入 Git。结构、CLI、Web、MCP 测试用临时目录模拟真实文件与 Git 提交，没有调用模型服务。

## 明确边界

结构快照表示**运行启动前**的工作树，不能证明测试期间源文件未变化。当前静态分析支持 JS/TS 与可用 Python 的声明和导入；Go/Rust 暂只有文件及包层级。跨语言动态调用、反射、运行时拓扑和三维渲染均未证实。关系来源与未知项在数据中保留，不能把静态推断写成运行观察。
