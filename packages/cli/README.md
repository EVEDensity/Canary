# canary CLI

## 目标

提供 `canary run` / `canary runs` / `canary show`，把配置、Runner、Coverage、Web UI 和本地 artifact 编排成一条本地用户路径。

## 边界

- CLI 负责参数、进程生命周期和退出码，不承载覆盖率算法、评测规则或前端业务状态。
- 交互运行默认绑定 `127.0.0.1` 并可自动打开页面；CI 使用 `--headless --no-open`。
- CLI 不把 HTTP 黑盒的 coverage unavailable 转成假数据。

## 当前使用入口

命令、项目定位和产物位置以[运行指南](../../docs/guides/running-and-ui.md)及[安装指南](../../docs/guides/getting-started.md)为准。当前 headless 仍短暂监听，自动浏览器打开在运行结束后；全局启动器改变 cwd，不能假定选择当前项目。CLI 仍依赖 Web 内部存储实现，拆分是[待实施任务](../../docs/roadmap/01-foundation-and-entry.md)，不是已完成边界。
