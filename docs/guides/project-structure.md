# 项目结构与变更模型

每次 `canary run` 在执行检查前采集一次项目结构，并将 `structure.json` 写入该次运行的 artifact。使用 `--base <git-ref>` 时还保存 `structure-change.json`。两份文件与运行报告一起进入 manifest；读取旧运行必须通过完整性校验。旧运行没有结构快照时，CLI、页面和 MCP 都不会用当前源码补画旧结果。

## 使用

```bash
canary structure --config canary.project.json
canary structure --base HEAD --config canary.project.json
canary run --ci --base HEAD --config canary.project.json
canary structure --run <runId> --config canary.project.json
```

普通 `canary run --base HEAD --port 4318` 也会保存同样的结构。页面“项目结构”读取 `/api/structure?runId=<runId>`，返回 `structure`、`change`、`coverageLinks` 和 manifest 状态。MCP 服务的只读 `canary.structure` 工具接受 `runId`，可选 `pathPrefix`、`offset`、`maxNodes`，每页最多 200 个节点；边、未知项和变更各有独立 offset 与后续页指针，避免静默截断。它只读绑定项目内已封存的运行。CLI 直接输出完整 JSON，供其他程序使用。

可选的项目根 `canary.architecture.json` 定义分层：

```json
{
  "v": 1,
  "layers": [
    { "id": "ui", "name": "界面层", "paths": ["apps/web/**"] },
    { "id": "domain", "name": "业务层", "paths": ["packages/domain/**"] },
    { "id": "data", "name": "数据层", "paths": ["packages/data/**"] }
  ]
}
```

路径相对项目根，支持 `*`、`**`、`?`。按配置顺序选第一个匹配层；未匹配节点保持未分层，避免猜测。规则无效时运行失败，不静默降级。

## 数据语义

- `nodes` 包括 workspace、应用、包、目录、文件、函数和类。节点 ID 根据项目内相对路径与符号名生成；插入行或改动函数体仍沿用 ID。`line/endLine` 是**该次采集**的源码位置，文件 `sourceHash` 是当时内容的 SHA-256。运行快照的 `source.runId` 明确指向所属运行；独立 `canary structure` 扫描没有该字段。
- `edges` 的 `contains`、`imports`、`package-dependency`、`calls` 均带 `provenance` 与 `certainty`。当前扫描器只输出能静态确认的关系：本地模块导入、工作区 `package.json` 依赖和可由 TypeScript checker 解析到本地声明的 JS/TS 调用。不会把可能调用标为已观察调用。
- `unknown` 标出无法确定的本地导入、外部或动态调用汇总、Python 调用分析缺口、尚未解析的 Python/Go/Rust 包依赖及无符号解析器的语言。Python 类、函数和本地相对导入由 Python 标准库 AST 提取，不执行项目代码。Go/Rust 可进入文件与包层级，但目前不解析其函数、类或调用；若无 Python 解释器，Python 只保留文件层级并标记缺口。
- Git 变更以用户明确给出的 ref 对比**本次工作树**，包含已跟踪及未跟踪文件的新增、修改、删除、重命名。`beforeId`、`afterId` 将移动前后节点连起来。Git 对已识别的重命名沿用其结果；未暂存的删除加新增仅在换行规范化后内容相同且唯一时配对，模糊移动保持新增与删除。提交 SHA、工作树 dirty 状态及文件清单哈希留在快照中。
- `coverageLinks` 用保存的覆盖文件路径与源文件 SHA-256 关联节点；只有哈希完全匹配才传递未覆盖位置。缺文件为 `unmapped`，内容不符为 `source-mismatch`。覆盖率是运行时采集数据，但 R10 不根据覆盖命中推断函数调用图。HTTP/MCP 黑盒项目没有源码覆盖采集时，这里不会编造数值。

结构扫描跳过 `.git`、`.canary`、依赖和构建目录以及符号链接；最多 10,000 个文件、总计 256 MiB、单文件 16 MiB，超出即报错。支持的源码符号解析以 JS/TS 和可用 Python 为限；R11 页面可交互查看二维结构与三维分层，操作方式见[架构地图指南](architecture-map.md)。
