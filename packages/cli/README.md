# canary CLI

## 目标

提供 `canary run` / `canary runs` / `canary show`，把配置、Runner、Coverage、Web UI 和本地 artifact 编排成一条本地用户路径。

## 边界

- CLI 负责参数、进程生命周期和退出码，不承载覆盖率算法、评测规则或前端业务状态。
- 交互运行默认绑定 `127.0.0.1` 并可自动打开页面；`--headless` 与 `web.enabled: false` 不创建监听。
- 运行用例在 `src/app.ts`，存储来自 `@canary/trace`；Web 只在非 headless 时动态加载。
- CLI 不把 HTTP 黑盒的 coverage unavailable 转成假数据。

## 当前使用入口

命令、项目定位和产物位置以[运行指南](../../docs/guides/running-and-ui.md)及[安装指南](../../docs/guides/getting-started.md)为准。全局启动器保留调用目录，用 `CANARY_HOME` 指向安装仓库；本地 `canary.config.ts` 优先于安装 Demo。所有读写命令共用 `ProjectContext`。

## Failure diagnostics

`canary diagnostics <runId> [--json] [--config <path>]` reads the same structured failure evidence shown in the check drawer. Export a sealed run with `canary diagnostics <runId> --out diagnostics.json`, then validate it with `canary diagnostics verify diagnostics.json` (exit 0 for valid, 1 for invalid). Existing report formats and exit codes are unchanged. Export refuses to overwrite an existing file.

The JSON bundle contains `diagnostics.json`, `NEXT-STEPS.txt` and a manifest with byte lengths and SHA-256 hashes. Hashes detect corruption, not authenticity. Only retained, redacted errors are included; environment requirements contain names, never values. Commit/runtime information is explicitly unavailable for historical runs that did not record it.

Each failure keeps its check or case identity, test names where recognizable, failed assertions, stack frames and reported source positions. Positions have `path-line` precision; they do not establish a verified source map or a root cause. The page opens source only through the existing hash-checked source viewer. Missing positions stay `missing`, causes stay `unknown`, and declared prerequisite failures are labeled as `hypothesis`. Similar text never groups unrelated failures.
