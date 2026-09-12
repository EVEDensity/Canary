# 文档重构与迁移记录

## 范围和原则

本次按实际代码整理 22 份原 docs 根目录 Markdown：14 份重写/合并为现状指南和目标设计，8 份有历史价值的报告/RFC/计划归档。新增理想自循环、硬规范、研究依据、证据索引和独立 roadmap；不修改运行时代码、配置或依赖，不启用自动循环，不执行 Git 提交/发布。

原本未跟踪的两份目标文档与 RFC-002 同样纳入迁移，未当作无用文件丢弃。两份目标文档纠正后分别由 product-architecture、agent-loop、evolution-policy、research 与 roadmap 承接；不再保留重复的活动规范。旧 RFC 原文保留在 archive，任务映射在 roadmap。

迁移前将原文件逐字节备份至本机临时审计目录；它不是仓库交付依赖，也不是永久备份承诺。下表保存原 SHA-256，归档保留原有事实/数字，仅加提示、修复链接和格式化。最终文档不应与迁移前原文件逐字节相同。

## 原文件到新入口

下表旧路径仅用于追溯，不是有效导航；右侧是当前文件。

| 原 docs 文件                              | 当前入口                                                                                                              | 处理                        |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `architecture.md`                         | [current/architecture.md](../current/architecture.md)                                                                 | 重写 / 合并，移除旧平铺副本 |
| `getting-started.md`                      | [guides/getting-started.md](../guides/getting-started.md)                                                             | 重写 / 合并，移除旧平铺副本 |
| `agent-adapter.md`                        | [guides/adapters-and-environment.md](../guides/adapters-and-environment.md)                                           | 重写 / 合并，移除旧平铺副本 |
| `mcp.md`                                  | [guides/adapters-and-environment.md](../guides/adapters-and-environment.md)                                           | 重写 / 合并，移除旧平铺副本 |
| `mock-environment.md`                     | [guides/adapters-and-environment.md](../guides/adapters-and-environment.md)                                           | 重写 / 合并，移除旧平铺副本 |
| `local-ui.md`                             | [guides/running-and-ui.md](../guides/running-and-ui.md)                                                               | 重写 / 合并，移除旧平铺副本 |
| `replay.md`                               | [guides/running-and-ui.md](../guides/running-and-ui.md)                                                               | 重写 / 合并，移除旧平铺副本 |
| `feature-coverage.md`                     | [guides/evaluation-and-coverage.md](../guides/evaluation-and-coverage.md)                                             | 重写 / 合并，移除旧平铺副本 |
| `self-improvement.md`                     | [guides/improvement.md](../guides/improvement.md)                                                                     | 重写 / 合并，移除旧平铺副本 |
| `ci.md`                                   | [guides/ci-and-validation.md](../guides/ci-and-validation.md)                                                         | 重写 / 合并，移除旧平铺副本 |
| `acceptance-10-min.md`                    | [guides/ci-and-validation.md](../guides/ci-and-validation.md)                                                         | 重写 / 合并，移除旧平铺副本 |
| `troubleshooting.md`                      | [guides/troubleshooting.md](../guides/troubleshooting.md)                                                             | 重写 / 合并，移除旧平铺副本 |
| `ARCHITECTURE-OPTIMIZATION-TARGET.md`     | [design/product-architecture.md](../design/product-architecture.md)                                                   | 重写 / 合并，移除旧平铺副本 |
| `AGENT-SELF-EVOLUTION-TARGET.md`          | [design/evolution-policy.md](../design/evolution-policy.md)                                                           | 重写 / 合并，移除旧平铺副本 |
| `RFC-002-ARCHITECTURE-EVOLUTION.md`       | [archive/rfc/RFC-002-ARCHITECTURE-EVOLUTION.md](../archive/rfc/RFC-002-ARCHITECTURE-EVOLUTION.md)                     | 历史归档                    |
| `MVP-ARCHITECTURE-INITIAL-REPORT.md`      | [archive/design/MVP-ARCHITECTURE-INITIAL-REPORT.md](../archive/design/MVP-ARCHITECTURE-INITIAL-REPORT.md)             | 历史归档                    |
| `MVP-IMPLEMENTATION-ACCEPTANCE-REVIEW.md` | [archive/reports/MVP-IMPLEMENTATION-ACCEPTANCE-REVIEW.md](../archive/reports/MVP-IMPLEMENTATION-ACCEPTANCE-REVIEW.md) | 历史归档                    |
| `WEEK-1-ISSUES.md`                        | [archive/reports/WEEK-1-ISSUES.md](../archive/reports/WEEK-1-ISSUES.md)                                               | 历史归档                    |
| `WEEK-2-ISSUES.md`                        | [archive/reports/WEEK-2-ISSUES.md](../archive/reports/WEEK-2-ISSUES.md)                                               | 历史归档                    |
| `WEEK-3-ISSUES.md`                        | [archive/reports/WEEK-3-ISSUES.md](../archive/reports/WEEK-3-ISSUES.md)                                               | 历史归档                    |
| `WEEK-2-PLAN.md`                          | [archive/plans/WEEK-2-PLAN.md](../archive/plans/WEEK-2-PLAN.md)                                                       | 历史归档                    |
| `WEEK-3-PLAN.md`                          | [archive/plans/WEEK-3-PLAN.md](../archive/plans/WEEK-3-PLAN.md)                                                       | 历史归档                    |

## 原文件指纹

| 原文件                                    | SHA-256（迁移前）                                                  |
| ----------------------------------------- | ------------------------------------------------------------------ |
| `architecture.md`                         | `e7e674dcacdf7eb30b1cb44c2194fd7dd2d8ebc1a028353e1b9a4b875d49bb53` |
| `getting-started.md`                      | `f48110bd5ba4845225c53c1fb3dc0db94d30c113268c7baa2aa0dc519b00b3b8` |
| `agent-adapter.md`                        | `49b0283db89a157895843869f0d4cd6257b6c7a38c68ea5c3d67e6d691c2fcce` |
| `mcp.md`                                  | `4e5e1a7ce9d2a49e78889765a0557ed5d1b6ad8a163ec042b98e3394cccec4eb` |
| `mock-environment.md`                     | `c64ad17ee284926e08994027b82471016c6f51fbcac49afec7f8ae7592bab57d` |
| `local-ui.md`                             | `1aa9650aade87e0577620fe9234d5104e4e25b18dcaf424eaa2c5a823a10149d` |
| `replay.md`                               | `754d5f98220c265b9b1405d62fe24e2890dd61ffb7f2f001440e5f2d0053e5e0` |
| `feature-coverage.md`                     | `9a0ce786082ff1fbad968b5adafb37e8622da2b8fda23c7614609f695eab4b55` |
| `self-improvement.md`                     | `e622c45ba41cca683158d01a3204da386cace9948a0e1754f360add2aa57c59b` |
| `ci.md`                                   | `8b2badaa524568b943d91e8479f93e4d94420b9b80cd25754e260d9ca75a6e78` |
| `acceptance-10-min.md`                    | `7686a3a6babd45e26651e3f5ae9645603e3e95bb1b6f3a97c1411a9b8599eac3` |
| `troubleshooting.md`                      | `056e8ceb1be3681569b0049e3fd442cb5d405762b336afd1d7dd6884eeb2baea` |
| `ARCHITECTURE-OPTIMIZATION-TARGET.md`     | `6762c2f92eae0c3b5172bda42cf22b155058c3ff2dbb02c8b0f38801f9158a3e` |
| `AGENT-SELF-EVOLUTION-TARGET.md`          | `4e955560f08abded781a014055cd12eb085b3465b10b14fa408418dc2eec4e1d` |
| `RFC-002-ARCHITECTURE-EVOLUTION.md`       | `8a1a08bd0b635fdd0bb806eaca647c43da3f305d09a4a909f48f9c724e5ab70a` |
| `MVP-ARCHITECTURE-INITIAL-REPORT.md`      | `e115bff774ba70ea1f826fc0f36a49ad206aea58369ccf2f5bc9c18b5daaa50f` |
| `MVP-IMPLEMENTATION-ACCEPTANCE-REVIEW.md` | `1132e61ce513d364445c9b9a3168254879f1d244937a83bc40805e092055fb25` |
| `WEEK-1-ISSUES.md`                        | `fb27500a9a88030481b32266587430cf0b151b746f9976765610de3b7f1592db` |
| `WEEK-2-ISSUES.md`                        | `15fe3df6c3ec75146b720847fe87b281d0bbeef714e39b2a9a5ae6a376650759` |
| `WEEK-3-ISSUES.md`                        | `a324bdde981a37f2aad76df46edeefb2c34c6346b2108a7d0be5d6c120e9b492` |
| `WEEK-2-PLAN.md`                          | `4f42f20635a4acf3768715ae3aae249678da576030fd49ee75b001d197adc631` |
| `WEEK-3-PLAN.md`                          | `b552292a2390a3dc278f74cac6e2dcaa2268724e045ebd4420b7ed051d02f8d3` |

## 图像与根入口

`docs/images` 保持原位，因为 Web 运行时引用其中的 logo。三张图像内容保持不变：

| 文件            | SHA-256                                                            |
| --------------- | ------------------------------------------------------------------ |
| logo-hero.png   | `73ab9002462b8e2367a3ad398d78fe39d7dc4e3f9bb07c79bbb7f2a1a4336a1c` |
| logo.png        | `00196d051834f6fc85df23a43c92161cff455aea54f13361ca92b63947c7801e` |
| ui-overview.png | `a91804caf28fa7841c2a189f5bc6910e668bb33ef3f238bf16f40fdd42bdd59f` |

根 README、CONTRIBUTING，以及 improvement、evaluators、runner、adapters、coverage、cli 的包 README 同步修正入口及能力边界。代码中的图像引用无需更改。

## 迁移校验

- 仓库 Markdown 扫描：54 个文件、201 个本地文件/锚点引用，0 个无效引用；扫描排除依赖、构建输出、Git 与运行产物。外网链接未做全站可用性保证。
- 22 份原文的备份 SHA-256 与迁移表一致，新入口全部存在，旧平铺副本均已移除。
- 8 份归档正文与原文在已说明的导航替换及 Prettier 格式归一化后完全一致，历史数字/结论未重写。
- 3 张图片哈希一致；19 个任务 ID 唯一，任务表均保持待实施。
- `pnpm format:check` 通过；六份更新过的包 README 单独 Prettier 检查通过；`git diff --check` 通过。
- Git 变更范围为 Markdown 与证据日志；运行时源码、依赖、配置没有内容变更。未暂存、提交或推送。

功能执行记录独立见[验证基线](validation-baseline.md)。
