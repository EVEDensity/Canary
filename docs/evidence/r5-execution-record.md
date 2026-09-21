# R5 本地控制面：执行记录

状态：已完成当前 Windows Node 24 范围。日期：2026-09-19（Asia/Shanghai）。

## 范围与基线

- 基线 commit `c0cceda`，叠加本工作区未提交的 R3/R4；保留已有改动。
- 修改范围：core 项目 web/resources 契约、CLI 会话/执行器、Web 服务/页面、专项测试、实机验收脚本和文档。
- 目标：运行中页面、脱敏日志与建议、历史比较、失败/单项重跑、回环隔离、关闭服务不丢证据、CI 结论一致。
- Windows 11 10.0.26200、Node 24.18.0、pnpm 10.15.0；没有新增运行时依赖。

## 验证

- `pnpm build`：通过，见 [构建日志](logs/r5/r5-build.txt)。
- `pnpm check`：typecheck、340 项测试（含新增 5 项 R5 测试）、lint、format 通过，见 [完整日志](logs/r5/r5-check.txt)。
- `pnpm verify:r5`：真实 CLI 四组验收通过，见 [结构化结果](logs/r5/r5-acceptance.json)和 [日志](logs/r5/r5-verify.txt)。覆盖运行中访问、失败重跑/依赖/脱敏/比较、单项执行期间停止服务仍封存三份证据、CI 与 artifact-only 结论一致。
- `pnpm verify:r4`：8 组回归通过，含 Node/Python、Canary 自身与源码未变化；见 [结构化记录](logs/r5/r5-r4-acceptance.json)与 [日志](logs/r5/r5-r4.txt)。
- R5 专项测试覆盖 SSE、端口占用、回环限制、Origin/Host/写令牌、损坏来源拒绝重跑、两个项目隔离、重启读取历史、资源诊断、可选项显式重跑门禁。
- 浏览器实测：初次 2/3 失败，补齐 fixture 文件后失败重跑 2/2 通过；比较显示 filesystem 失败→通过、资源未运行；日志有真实换行且刷新后保持展开；停止服务后控件禁用。测试服务均已关闭。

过程修正：浏览器日志展开被轮询重建折叠，改为按运行/检查保留状态；日志换行转义修正。验收脚本最初在状态结束但证据尚未封存时重跑，服务正确拒绝，脚本改为等待 manifest verified；Windows 清理等待子进程退出。没有放宽完整性或鉴权断言。

## 主线一致性与边界

本地优先，无自动外发、源码修复、Docker 启停或自动重试循环。projectRoot 决定历史集合，installRoot 不承载项目历史。页面消费现有脱敏快照；不流出未经扫描的 stdout 分片。重跑生成独立证据并绑定父 manifest，依赖重新执行。停止报告服务不会取消检查；终端取消仍进入既有恢复路径。

当前完成的是 R5。Docker daemon 成功路径仍未实测；Linux/macOS、Node 22 和真实多种 Agent fixture 属于 R6；资源快照不能替代 R7 长跑/配额。没有以本机成功宣称生产级或完整生态支持。普通 run 与 CI 对同一配置使用相同门禁；可选资源检查需显式配置。下一阶段 R6。

回退仅移除 R5 的 project-session/project-ui、resources/web/activeCheck 扩展及对应接线，保留既有 R3/R4。可先使用 `--headless` 运行项目检查。未执行 commit、push、全局安装或部署。使用说明见 [R5 指南](../guides/r5-local-report.md)。

浏览器验收 fixture 保留于 `.canary/r5-ui-fixture`：清理删除操作被自动审批策略拦截，未再次尝试删除；服务已经停止。
