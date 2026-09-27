# 架构诊断、变更影响与增量 CI

要求：Node 22+；当前真实验收环境是 Windows Node 24。项目已有 Canary 检查配置。

## 使用入口

```bash
canary analyze --config canary.project.json
canary impact --base HEAD --config canary.project.json
canary run --ci --affected --base HEAD --config canary.project.json
canary run --port 4318 --base HEAD --config canary.project.json
canary impact --run <runId> --config canary.project.json
```

`analyze` 和 `impact` 默认输出 JSON。`impact` 预览计划，不运行检查。普通 `run` 默认全量；`--affected` 是显式请求，必须有可解析的 Git 基线。Agent 用例不能用该标志缩减，仍使用其显式 case/tag 选择。

比较范围是指定 commit 到当前工作树，包含已提交差异、暂存、未暂存与未忽略的新文件。CI 浅克隆需事先取到指定基线 commit；不存在或非法的 ref 返回配置错误退出码 2。Canary 不自动 fetch 或推送。

## 架构规则

`canary.architecture.json`：

```json
{
  "v": 1,
  "layers": [
    { "id": "ui", "name": "界面", "paths": ["src/ui/**"] },
    { "id": "logic", "name": "业务", "paths": ["src/logic/**"] }
  ],
  "rules": {
    "forbiddenDependencies": [{ "from": "logic", "to": "ui", "reason": "业务层不依赖界面层" }]
  }
}
```

只对已解析的静态模块导入与包依赖判定循环和违规，保留节点、依赖边与路径。循环是风险观察，不等于已经发生运行错误。扇入/扇出达到 8 时作为耦合观察展示，阈值不用于判失败。没有规则时不会猜测某个层间方向是否违规。

JS/TS 支持相对导入、可解析的根 tsconfig 路径别名、字面量 `require` 和 `import()`。解析不了的本地模块、表达式形式动态导入、语法错误与缺失语言适配器保留未知。调用图与模型推断不参与缩减 CI。架构发现当前只用于诊断，不自动令项目 CI 失败；需要架构门禁可用显式项目检查调用分析并判断指定规则。

## 检查输入范围

在现有项目检查中添加 `impact`：

```json
{
  "kind": "canary.project",
  "version": 1,
  "checks": [
    {
      "id": "prepare",
      "type": "command",
      "command": "node",
      "args": ["scripts/prepare.mjs"],
      "impact": { "always": true }
    },
    {
      "id": "ui.test",
      "type": "command",
      "command": "node",
      "args": ["--test", "src/ui/ui.test.mjs"],
      "dependsOn": ["prepare"],
      "impact": { "paths": ["src/ui/**", "scripts/prepare.mjs"] }
    }
  ]
}
```

`paths` 必须声明检查使用的**全部项目输入**，包括测试、fixture、辅助脚本及业务代码；这是项目作者的范围契约。相对项目根目录匹配，支持 `*`、`**`、`?`。即使检查在其他 cwd 执行，模式仍相对根目录。未声明范围、仅声明 `always` 或 `always: true` 的检查始终运行。

变更输入及其反向依赖消费者都会匹配范围。共享包的变化还会保守扩展到本包和消费者包的成员。选中的检查前置依赖会重新执行，不复用旧通过记录。

前置检查本身有受影响输入时，其下游检查也会选中。HTTP、Docker、资源、常驻进程及 Agent 检查依赖当前运行环境，始终运行；声明了环境变量 allowlist 的命令也不会仅凭文件范围省略。

以下情况执行全量：删除/重命名缺少旧版依赖图；静态图存在模块或语言解析缺口；变更输入不在图中；依赖锁、包清单、tsconfig、Canary/其他全局配置、`.env` 或 `.github/` 变化；没有变更或没有选中必需检查。动态行为无法靠静态图保证，范围声明不完整时应继续全量。定期或发布前全量的频次由使用项目的 CI 策略决定。

## 页面及证据

页面“项目结构”在地图下提供“架构诊断 / 变更影响 / CI 计划”。诊断点击源码路径进入节点；影响详情保留由直接变更到消费者的解释链；CI 计划显示每项运行、省略、匹配路径与回退原因，实际执行项可打开原始检查证据。

增量页面显式标记范围。`ci.json` 及 CLI 机器输出的可选 `selection` 保存 `requested/mode/planned/selected/omitted/fallbackReasons`；它是选择计划，实际执行状态看 `checks`。JSON 报告另存省略清单；Markdown 标为 omitted；JUnit 将省略项写为 skipped，不计为通过。

新运行的 manifest 包含：

- `structure.json`：封存结构、源码哈希、可选分层规则；
- `architecture-analysis.json`：`canary.architecture-analysis` v1，结果依据、发现、未知和截断计数；
- `change-impact.json`：`canary.change-impact` v1，Git 基线、变更路径、潜在影响与解释路径、回退原因；
- `ci-plan.json`：`canary.ci-selection` v1，全部检查的选择理由；
- `ci-original-plan.json`：原配置；`check-plan.json`：实际选择的检查配置。

历史命令与 `/api/structure` 读取同一运行的封存结果，不用当前源码重新解释旧运行。旧 artifact 无新分析时明确缺失。MCP `canary.structure` 返回与所读节点相关的有界诊断和影响页，带返回总数；CI 计划摘要最多 30 项，完整清单通过项目本地 artifact 查看。

## 快速验收与回退

```bash
pnpm build
pnpm verify:map
pnpm verify:architecture-ci
```

浏览器验收自动选择本机 Edge/Chromium，或通过 `CANARY_BROWSER_EXECUTABLE` 指定。使用独立无头浏览器 profile，只连接回环调试端口。日志与 fixture 在 `.canary/logs/verification/`、`.canary/verification/`，不写入源码。

取消增量执行只需移除 `--affected`；旧配置无需添加新字段。分析规则可删除后重新运行，新旧 artifact 保留各自规则。没有自动安装 Skill、自动修复源码或模型调用。
