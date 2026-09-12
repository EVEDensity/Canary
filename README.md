# canary

`canary` 是 Agent 的本地评测与改进控制台：一键运行可本地观测的 TypeScript Agent，关联执行轨迹、行为断言与源码覆盖率，并把失败转为可检查的 artifact。

架构说明见 [`docs/MVP-ARCHITECTURE-INITIAL-REPORT.md`](./docs/MVP-ARCHITECTURE-INITIAL-REPORT.md)。Week 2 计划见 [`docs/WEEK-2-PLAN.md`](./docs/WEEK-2-PLAN.md)；真实执行结果见 [`docs/WEEK-2-ISSUES.md`](./docs/WEEK-2-ISSUES.md)。

## 当前能力

- `packages/core`：配置、TestCase、Coverage、Feature、断言契约
- `packages/coverage`：Coverage Manifest、TypeScript AST、V8 / source-map 映射、Feature Coverage
- `packages/runner`：每 case 独立子进程、timeout/cancel、provisional Coverage 采样
- `packages/evaluators`：Agent 输出 / 轨迹 / 终止 / 预算断言
- `packages/cli`：`canary run` / `canary runs` / `canary show`
- `apps/web`：本地 UI、SSE、Artifact Replay
- `examples/local-agent`：无外部密钥的最小 Agent

## 运行

Node.js 22+。常用命令：

```powershell
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm canary -- run --headless --no-open
pnpm canary -- runs
pnpm canary -- show <runId>
```

根配置 `canary.config.ts` 指向 `examples/local-agent`。产物写入 `.canary/artifacts/<runId>/`：

```text
run.json
coverage.json
coverage-manifest.json
trajectory.json
evaluator.json
```

Coverage P0 只针对可本地观测的 Node/TypeScript Agent。没有源码插桩的黑盒 HTTP Agent 必须报告 `unavailable`，不能伪造百分比。
