# Pi 外部 fixture

固定来源：[earendil-works/pi v0.86.0](https://github.com/earendil-works/pi/releases/tag/v0.86.0)，commit `ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc`。2026-09-20 通过 GitHub release/tag API 核对；旧 badlogic/pi-mono 已重定向到该仓库。

此目录提供真实外部依赖的固定声明，不包含冒充 Pi 的实现。当前 `verify:r6` 将 Pi 模型场景记录为 blocked。解除该项需要独立的受信任 checkout、固定版本运行时、用户明确选择的模型/本地 provider，以及其凭证或离线服务。默认不安装、不寻找凭证、不执行付费推理。

在明确授权的隔离环境安装 `@earendil-works/pi-coding-agent@0.86.0` 后，先记录 `pi --version`。随后按照该版本[官方说明](https://github.com/earendil-works/pi/blob/v0.86.0/packages/coding-agent/README.md)接入 provider，使用固定输入和有界预算运行，再将真实输出、版本、网络/凭证边界与 manifest 纳入验收。只有版本探测不能把模型 fixture 改为 verified。

## 隔离运行时验收

`node scripts/verify-r6-pi.mjs --install` 显式下载固定包，禁用安装脚本，使用全新的用户目录和 npm 缓存。脚本核对 npm integrity 与版本，经 Canary 项目门禁运行真实 `pi --version` 和 `pi --help`，验证输出及 manifest；不读取现有 Pi 配置，不继承 provider 凭证，不调用模型。运行时 passed 与模型推理 blocked 分开记录。默认结果为 `docs/evidence/logs/r6-pi-runtime.json`；可用 `CANARY_R6_PI_OUTPUT` 指定历史文件名。

2026-09-20 复核固定 commit 的 package.json 后发现旧包名在 0.86.0 返回 npm 404，改为上游实际发布的 `@earendil-works` scope。既有证据文件保持原样。
