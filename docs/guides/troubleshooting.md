# 当前限制与排查

| 现象                            | 按代码排查                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 在自己的项目执行却跑 Demo       | 当前已移除 home fallback；若仍发生，检查是否调用旧 launcher。运行 canary paths --json 并显式传 --config；重建后再更新 launcher |
| 找不到历史 run                  | 运行 artifacts 在配置目录；历史命令不统一支持 --config，可能正在查另一个 root                                                  |
| 浏览器迟迟未打开                | 当前自动打开在执行之后，不是一定卡死；看进程与日志                                                                             |
| headless 仍出现端口             | 当前确实先监听再关闭；web.enabled 尚未控制创建路径                                                                             |
| coverage unavailable / pct=0    | 看 status，可能是远端黑盒或无可用采集，不能当成实际 0%                                                                         |
| judge.score 通过但未调用 LLM    | 未注入 provider 时使用 deterministic 输出存在检查                                                                              |
| 所有 case 看似通过却退出失败    | 检查 gate.json、非预期 policy/loop、state 与 feature unavailable                                                               |
| compare 很好但运行曾失败        | candidate/compare 会合并 exitCode 与 incomparable；仍请核对 admission，它不是发布许可                                          |
| verified 草稿不能直接运行       | 草稿可能缺完整断言参数；verified 只是建议状态，需人工审阅                                                                      |
| MCP Demo 成功但真实服务不兼容   | 目前是简化 tools/call 传输，不是完整版本化协议客户端                                                                           |
| Ctrl+C 后仍有残留进程           | function/http/mcp 已统一映射为 cancelled/timeout；检查 checkpoint.json。进程树终止已在 Windows 验证，不是 OS 沙箱              |
| Snapshot restore 未撤销外部操作 | 当前只恢复受管内存状态，不恢复远端服务或文件                                                                                   |

不要用降低门禁、删除用例、把 unavailable 填成通过等方式“修复”以上问题。实际缺口和任务见 [源码核对](../evidence/code-audit.md)。
