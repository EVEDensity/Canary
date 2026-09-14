# H-01 威胁模型与进程边界

> 配套 [H-01 范围](h01-scope.md)。这是可执行隔离的设计依据，不是 OS 认证。

## 信任边界

| 区域           | 角色                                                                           | 信任                                                  |
| -------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------- |
| 控制面         | CLI、策略引擎、授权/预算账本、独立评估比较、正式经验库、受信应用器、循环控制器 | 受信。不执行候选源码。                                |
| 隔离监督器     | `@canary/isolation` 启动器：构造 allowlist 环境、写入 preload、监视子进程      | 受信。在沙箱外。                                      |
| 沙箱内         | 候选 Agent worker、候选工具、由候选发起的 HTTP/MCP                             | 不可信。                                              |
| 宿主 IDE Agent | 用户本机的 Codex/Cursor 等，可能拥有 shell                                     | Canary 不能约束宿主绕过。Skill 只能限制 Canary 接口。 |

默认 `canary run` 评估**用户自己的**项目 Agent 时，worker 仍是 Node 子进程，**不是** OS 沙箱。H-01 不把这条路径改成强制 OS 隔离，以免破坏基础评估。未隔离执行不得用于自动硬写或运行未知候选。

## 进程分类

### 沙箱外（受信）

- `canary` CLI、`runEvaluation`、Judge/coverage 聚合、`compareRuns` / `decideAdmission`
- `PolicyStore`、`AuthorizationStore`、`BudgetLedger`（`.canary/policy/`）
- 隔离监督器（spawn + wait + kill）
- H-03 应用器、L-01 控制器（后续任务）

### 沙箱内（不可信）

- 带 isolation preload 的候选/未授权 worker
- 该 worker 创建的子进程（默认禁止）
- 该 worker 发出的网络请求（默认拒绝，经允许列表代理）

### 明确不等于安全边界的东西

- Git worktree / 候选目录拷贝
- 普通 `child_process.spawn` 且继承 `process.env`
- MCP 工具的“请不要越权”提示词
- `MemoryStateStore.restore`（只恢复内存对象，不撤销 HTTP/MCP/文件系统外界副作用）

## 能力模型

| 模式        | 机制                                                   | 何时使用                                      | 缺失时                              |
| ----------- | ------------------------------------------------------ | --------------------------------------------- | ----------------------------------- |
| `none`      | 现有 runner 子进程                                     | 受信项目的默认评估                            | 允许                                |
| `userspace` | 受限 env + fs/net/process preload，realpath/inode 校验 | 未信任候选试验；本仓库 Windows 上的可验证隔离 | 若策略要求隔离则 fail closed        |
| `os`        | 探测到 Docker/`bwrap` 时可用                           | 策略显式要求 OS 隔离的自动硬写                | fail closed，不得降级为无隔离自动写 |

Windows 本机可验证的是 `userspace`。Docker 若存在可升级为 `os`。userspace **不是** AppContainer/内核沙箱；原生扩展仍可能绕过 hook。因此自动硬写在策略要求 `os` 且探测失败时必须拒绝启动。

## 资产

- 项目源码与 Git 工作区
- 评估用例、保留集、阈值、`canary.config.ts`
- `.canary/policy/` 策略、授权、预算、审批
- 环境变量中的密钥
- 网络与外部工具

## 威胁与缓解

| ID   | 威胁                                     | 缓解                                                  | POL       |
| ---- | ---------------------------------------- | ----------------------------------------------------- | --------- |
| T-01 | 候选改阈值或删除失败用例                 | 策略与评估数据在沙箱外只读；变更面检查拒绝保护路径    | POL-01    |
| T-02 | 路径穿越、符号链接、硬链接指向保护文件   | 先 realpath/lstat，再与根比较；保护路径 inode 登记    | POL-02    |
| T-03 | 读父目录或密钥、连未授权主机、随意 spawn | env allowlist；网络/工具代理；禁止 child_process      | POL-03    |
| T-04 | 质量增益抵消越权                         | 固定决策器：安全/状态门禁不能被分数抵消               | POL-05    |
| T-05 | 候选自带 `approved`/`report`             | 审批只读控制面存储，忽略工作区伪造字段                | POL-06    |
| T-06 | 并发候选合计超额                         | 带锁预算账本，先 reserve 再 commit                    | POL-07    |
| T-07 | Trace/tool 输出升为系统规则              | 经验加载器拒绝注入；策略激活检查                      | POL-09    |
| T-08 | 恶意 config/predicate 在控制进程执行     | 隔离试验不 import 候选 config；predicate 不得作为策略 | POL-01/02 |
| T-09 | 后台子进程在取消后继续                   | preload 禁止 spawn；监督器 kill 进程树                | POL-03    |
| T-10 | 隔离能力缺失仍自动写                     | fail closed                                           | 失败策略  |

## 残留风险

- 用户把 Canary Skill 接到仍有全盘权限的宿主 Agent 时，宿主可绕过 Canary。
- userspace hook 可被原生插件或未包装 API 绕过。
- `MemoryStateStore` 不能回滚已发生的外界副作用；因此沙箱默认禁止真实外发。
- 本威胁模型不覆盖 S-02 MCP Server 或生产部署。
