# S-03 执行记录

## 基线与环境

- 基线 commit：`01c22c357985eaaf08edadc86c7efe85730cfb92`
- 执行日期：2026-09-13
- 工作区：Windows / Node `v24.18.0` / pnpm `10.15.0`
- 工作协议：`docs/roadmap/00-working-protocol.md`
- 范围冻结：`docs/evidence/s03-scope.md`

## 目标与非目标

S-03 只实现项目级、版本化、可审计的经验库和加载器：经验必须经过 `proposed → validated → active`，加载时检查项目、激活指针、作用域、失效时间、敏感信息、提示/工具注入和上下文预算，并把实际加载的版本和内容哈希记录到下一轮 `run.json`。经验正文只注入单次 Agent 执行上下文，不写入项目源码或全局系统提示。

本次不实现 S-02、S-04、H-01，不实现跨项目共享、MCP Server、分布式同步、自动批准、自动发布、源码修改或无限对话记忆。

## 实现内容

- 新增 `@canary/experience` 包：
  - `.canary/experiences/records/<id>.json` 版本化记录；
  - `.canary/experiences/active.json` 激活指针；
  - 状态转换、版本递增、内容 SHA-256、去重、过期、撤销、预算和安全检查。
- CLI 新增结构化经验命令：
  - `list`、`propose`、`validate`、`activate`、`revoke`、`expire`、`load`、`clear`；
  - 提议和状态变更均保留 `approval.status=not_approved`，不会自动提升权限。
- Runner/宿主工作流：
  - 每个 case 按 case/tag/feature 作用域加载经验；
  - 经验通过 Runner 子进程上下文的 `ctx.experiences` 传递给 Agent；
  - 未加载正文不会进入 `RunSnapshot`，`RunSnapshot.experiences` 只保存 ID、key、version、contentHash、loadedAt。
- 增加包级测试和 CLI 端到端测试，覆盖激活前不加载、实际注入、`run.json` 审计、恶意内容拒绝、过期后恢复无经验基线和源码不变。
- 修复 `@canary/experience` 的 TypeScript project reference，使 workspace 构建和根级验证可正常执行。

## 验收矩阵

| 条件                                  | 结果 | 证据                                                         |
| ------------------------------------- | ---- | ------------------------------------------------------------ |
| 提议记录落盘                          | 通过 | `packages/experience/tests/experience.test.ts`、CLI S-03 e2e |
| 未验证/未激活经验不加载               | 通过 | CLI `experience load` e2e                                    |
| 激活经验进入下一轮 Agent 上下文       | 通过 | CLI S-03 e2e 检查 `ctx.experiences`                          |
| `run.json` 记录实际版本与内容哈希     | 通过 | CLI S-03 e2e 检查 `RunSnapshot.experiences` 和 artifact      |
| 过期经验不加载                        | 通过 | 包级测试与 CLI S-03 e2e                                      |
| 跨项目经验不加载                      | 通过 | `packages/experience/tests/experience.test.ts`               |
| 敏感数据、提示注入和 tool output 拒绝 | 通过 | `packages/experience/tests/experience.test.ts`、CLI S-03 e2e |
| 清空激活指针恢复基线                  | 通过 | 包级测试与 CLI S-03 e2e                                      |
| 经验更新不修改项目源码                | 通过 | 包级测试与 CLI S-03 e2e                                      |
| 默认 demo 仍成功                      | 通过 | 15/15 cases、45/45 assertions                                |

## 验证结果

- `pnpm build`：通过，exit 0。
- `pnpm test`：通过，所有 workspace 测试通过；CLI 端到端为 27 tests passed，经验包为 4 tests passed。
- `pnpm typecheck`：通过，exit 0。
- `pnpm lint`：通过，exit 0。
- `pnpm format:check`：通过，exit 0。首次检查仅因新增范围文档未格式化而失败，已运行 Prettier 后复验通过。
- `pnpm demo:headless`：通过，15/15 cases、45/45 assertions，exit 0。

详细命令日志见：

- `docs/evidence/logs/s03-build.txt`
- `docs/evidence/logs/s03-test.txt`
- `docs/evidence/logs/s03-typecheck.txt`
- `docs/evidence/logs/s03-lint.txt`
- `docs/evidence/logs/s03-format-check.txt`
- `docs/evidence/logs/s03-demo-headless.txt`
- `docs/evidence/s03-validation-results.json`

## 风险与未覆盖边界

- 经验内容仍是显式、受限的运行上下文，不等同于系统或开发者指令。
- 当前安全检查是本地规则和人工状态转换，不是 H-01 隔离；不能据此宣称未知代码安全。
- 尚未实现 S-04 的基线/保留集/候选经验实验编排，也未实现跨项目共享或远端分发。
- 经验历史记录可审计保留；停用依靠状态和激活指针，不删除历史文件。

## 路线图决策

S-03 的实现、集成和验收均已完成，因此更新 `docs/roadmap/README.md` 总表中的 S-03 为“已实施”。按工作协议，不开始 S-02、S-04 或 H-01。
