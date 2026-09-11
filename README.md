# canary scaffold

`canary` 当前是一个解耦的 TypeScript monorepo 骨架，依据 [`docs/MVP-ARCHITECTURE-INITIAL-REPORT.md`](./docs/MVP-ARCHITECTURE-INITIAL-REPORT.md) 初始化。

## 当前已创建

- `packages/core`：领域契约与配置边界
- `packages/runner`：执行编排边界
- `packages/coverage`：覆盖率采集边界与 feature instrumentation 占位
- `packages/adapters`：Agent 接入边界
- `packages/environment`：Mock/状态环境边界
- `packages/trace`：轨迹事件边界
- `packages/evaluators`：评测器边界
- `packages/reporters`：报告边界
- `packages/improvement`：自进化建议边界
- `packages/cli`：CLI 边界
- `apps/web`：本地 UI 与 SSE 边界
- `examples/local-agent`：无外部密钥的 Agent 示例
- `cases/{smoke,regression,holdout}`：能力测试数据分层
- `.canary/{runs,artifacts}`：本地运行产物（已忽略）

## 运行约定

Node.js 22+ 是当前开发基线；coverage P0 只针对可本地观测的 Node/TypeScript Agent。黑盒 HTTP Agent 没有源码插桩时，覆盖率应为 `unavailable`，不能伪造数值。

下一阶段实现应从 `packages/coverage` 的 fixture 验证、`packages/runner` execution 生命周期、`apps/web` SSE 和 `packages/cli` 一键编排开始。
