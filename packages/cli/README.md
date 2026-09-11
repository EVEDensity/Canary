# canary CLI

## 目标

提供 `canary init/run/open/replay/report/doctor`，把配置、Runner、Coverage、Web UI 和 Reporters 编排成一条本地用户路径。

## 边界

- CLI 负责参数、进程生命周期和退出码，不承载覆盖率算法、评测规则或前端业务状态。
- 交互运行默认绑定 `127.0.0.1` 并可自动打开页面；CI 使用 `--headless --no-open`。
- CLI 不把 HTTP 黑盒的 coverage unavailable 转成假数据。
