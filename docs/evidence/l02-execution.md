# L-02 执行与验收记录

- 日期：2026-09-14；基线：`92cd997b3b1e506c6df204fba8c803ce252be010`。
- 环境：Windows、Node 24.18.0、pnpm 10.15.0。
- 变更：新增 packages/control-plane；集成 CLI、Web、loop 停止边界及 policy 保护；新增测试、指南、范围与威胁模型文档。
- 行为：版本谱系、加载经验、实测指标/自述分栏、预算授权、固定锚点累计漂移、保留集轮换与暴露审计；默认只读，显式受保护审批/撤销/回滚。
- 安全：路径 containment、链接拒绝、原子写入、独占锁、pending 审计与显式 reconciliation、幂等及版本绑定、授权/策略复验、回滚防覆盖。

## 最终验证

| 命令               | 退出码 | 结果                                                      |
| ------------------ | ------ | --------------------------------------------------------- |
| pnpm build         | 0      | 全工作区通过                                              |
| pnpm test          | 0      | 全工作区通过；control-plane 25、Web 16、CLI 34、loop 6 项 |
| pnpm typecheck     | 0      | 通过                                                      |
| pnpm lint          | 0      | 通过                                                      |
| pnpm demo:headless | 0      | 15/15 cases，45/45 assertions                             |
| pnpm format:check  | 0      | 通过                                                      |
| git diff --check   | 0      | 无空白错误                                                |

最终 demo：`run_50d4f19b-a421-45d5-bc7a-fa14894a1d04`；lines 78/79、functions 20/20、branches 37/48、statements 80/87。命令日志保存在本地忽略的 `.canary/l02-*.log`。指南中的 CLI JSON 读取命令已实际验证。

首次全量回归中，未修改的 evaluator HTTP abort 测试在固定 40ms 等待后未观察到关闭事件。原始日志为 `.canary/l02-test-initial-failure.log`。未修改测试或放宽门槛，该包单独复测及随后两次全量回归通过；记录为既有时序敏感测试间歇性失败。

## 浏览器证据

独立临时合成项目完成五个导航、只读禁写、凭证解锁、真实 POST、刷新/服务重启后的审计保留。固定锚点展示 -1/-2/-3 pp 累计变化并在超过 2 pp 时检测退化；缺失 Judge 保持不可用。移动端 390×844 主题切换生效，无页面整体横向溢出，导航允许局部滚动，浏览器错误日志为空。

截图：`assets/l02-desktop-dark.png`、`assets/l02-desktop-light.png`、`assets/l02-mobile-light.png`。全部为合成数据，不作为真实模型质量证明。临时服务在验收后停止。

## 未覆盖边界与回滚

未宣称跨平台验证、多租户身份隔离、OS 沙箱、系统外无泄漏、统计显著性、长期单调进步或真实付费 Judge 认证。旧写入者不共享控制面事务锁。操作停止不能撤回已发生的外部副作用。

回滚先停止专用服务；必要时仅撤回本任务代码，保留原运行产物及控制面历史。未启动真实循环、真实候选应用或生产部署；未创建提交。L-03 仍待实施。
