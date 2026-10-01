# R6 固定 Agent fixtures

在仓库根目录执行 `pnpm build && pnpm verify:r6`。脚本将 fixture 复制到独立临时项目，再用真实 CLI 执行，不在 fixture 源目录写 artifact。

- `deterministic-agent`：函数适配器，输入 ping，断言实际输出为 `{answer: "pong"}`。
- `tool-calling-agent`：函数调用本地 mock echo 工具，同时验证工具事件和实际返回值。
- `http-agent`：独立 Node HTTP 进程，仅监听回环随机端口；脚本注入 URL 并在结束时停止服务。明确报告 coverage unavailable。
- `mcp-agent`：独立 stdio JSON-RPC 进程，验证现有 MCP run 适配器。不是完整 MCP 协议一致性认证。
- `pi-agent`：固定真实上游来源和版本；当前模型执行 blocked，不用本地 echo 冒充 Pi 成功。

每个目录的 `fixture.json` 定义来源、版本、启动方式、凭证、offline 行为、期望输出及副作用。四个本地 fixture 固定为 `r6-v1-lf`，哈希对应 Git 中使用 LF 换行的原始文件字节，与仓库 `.gitattributes` 一致。该版本仅修正此前按 CRLF 生成的哈希，不改变 fixture 行为。文件 SHA-256 在执行前严格验证；修改 fixture 必须同时更新版本说明和哈希，并重新验收。

脚本不扫描凭证、不连接模型、不更改被测源码。只有 HTTP fixture 使用临时回环监听。临时项目及 artifact 保留供审计，位置见验收 JSON 的 `artifactBase`。Windows 权限测试仅对本次创建的 `.canary` 目录加入当前用户写入拒绝 ACL，并在 finally 中恢复；POSIX 仅对自建目录临时 chmod，root 运行会将该项标 blocked。

完整使用与边界见 [R6 指南](../../docs/guides/r6-platform-fixtures.md)。
