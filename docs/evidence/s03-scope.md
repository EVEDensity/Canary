# S-03 冻结范围

## 基线与环境

- 基线 commit：`01c22c357985eaaf08edadc86c7efe85730cfb92`
- 工作区：Windows / Node `v24.18.0` / pnpm `10.15.0`
- 任务：S-03「版本化经验库和加载器」

## 目标

1. 在项目 `.canary/experiences/` 下保存版本化、可审计的经验记录。
2. 支持 `proposed → validated → active`，以及 `expired`、`revoked` 的明确状态。
3. 只加载当前项目、当前激活指针、未过期、通过敏感数据与提示注入检查的经验。
4. 对检索结果执行去重、冲突排除和条目/字符预算；在下一次运行的 `run.json` 中记录实际加载的版本与哈希。
5. 经验只作为显式运行上下文提供给 Agent，不写入源码、全局系统指令或模型权重。
6. 清空激活指针后，运行恢复为无经验基线。

## 非目标

- 不保存对话原文、无限记忆或训练基础模型。
- 不自动把工具输出、宿主提案或未批准内容提升为系统规则。
- 不修改项目源码，不实现自动批准、自动发布或 S-04 的实验编排。
- 不实现跨项目共享、分布式同步、MCP Server 或安全沙箱。

## 可改路径

- `packages/core/src/{contracts,types,schema}.ts`
- `packages/experience/**`（新建）
- `packages/runner/src/**`
- `packages/cli/src/**`
- `packages/*/tests/**`
- `docs/evidence/**`、`docs/roadmap/README.md`

## 验收命令

- `pnpm build`
- `pnpm test`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check`
- `pnpm demo:headless`

并额外验证：提议、验证、激活、下一轮实际加载、过期/跨项目/恶意内容拒绝、撤销后恢复基线、源码哈希不变。

## 停止条件与回滚边界

- 只实现 S-03；不开始 S-04、S-02、H-01。
- 若无法让下一轮 `run.json` 记录加载版本，S-03 不得标记完成。
- 回滚时删除本任务新增的经验包、CLI 接线和文档；保留既有 S-01 产物与 CLI 行为。
- 经验历史文件可保留用于审计；停用通过激活指针和状态完成，不删除历史恢复状态。
