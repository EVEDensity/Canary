# 开源 Preview 收口与最终打磨

日期：2026-09-30；基线 `67e765f`，Windows 11、Node 24.18.0、项目 pnpm 10.15.0。本轮范围为依赖安全修补、首次使用/维护文档、当前公开文件风险检查与后续打磨排序。

按用户决定，OS-01 历史产物保留，后续新日志保持忽略；OS-03 远端 CI 及原生平台补验留到开源后。本轮不更改可见性、不推送、不发 tag、不发布 npm 包。

## OS-02 依赖安全修补

- Vitest 从锁定的 3.2.7 升级到 4.1.11，直接范围 `^4.1.11`，不迁移到 5.x。依据：[上游 GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9)；修复同时覆盖 companion mocker。
- `pnpm-workspace.yaml` 对 `brace-expansion@>=5.0.0 <5.0.12` 指定 5.0.12，保持 5.x 范围，覆盖 ESLint/TypeScript-ESLint 的传递路径；其他主版本不被强行替换。
- 更新 lockfile；CLI/Web/Structure 配置移除 Vitest 4 不支持的 minWorkers，保留原并发上限、超时和断言。
- Vitest 4 默认不再排除 dist，Control Plane 在一次完整运行中同时发现源测试和编译测试；增加该包配置排除 dist，避免测试重复计数。源测试单独运行 28 项通过，不删除源测试。

完整 `pnpm audit --json` 从 2 high、3 moderate 通告条目变为全部 0；此前条目包括同一上游通告在多个包中的重复呈现。审计是依赖数据库对当前 lockfile 的结果，不等于安全认证。

原始结果在忽略目录 `.canary/logs/verification/open-source/dependency-audit-after.json`。没有添加 ignoreCves、忽略告警或放宽审计门槛。

## OS-04 文档与首次使用

README 重新围绕普通项目检查、失败证据和架构地图介绍产品，明确 0.1.0 Preview。提供源码安装、用户级启动器、目标项目最小 JSON、诊断与报告命令；将 R16–R21 写为待实施。

首次示例实际验证发现 Windows 直接启动 npm `.cmd` 会按既有无 shell 运行器策略 blocked；已将 README 改为 `node --run build/test`，说明它不会调用 npm pre/post 生命周期。修正版在独立 fixture 中执行 2/2 检查通过；旧失败记录仍保留。这证明示例运行链路，不代表任意项目脚本兼容。

`getting-started` 补固定版本、更新/卸载及常见问题。`CONTRIBUTING` 补工具链、合理验证、日志清理、提交内容审查和许可证维护。`SECURITY` 补信任边界、受维护版本和报告方式。

GitHub 私密漏洞报告接口本轮返回 404，不能宣称该渠道已启用。文档给出开启后可用的报告入口及当前协调方式：公开 Issue 只询问私密联系方式，不发送漏洞或密钥细节。开源时仍需维护者启用该设置或提供实际私密联系方式。

## 当前文件的泄漏风险

本轮有限扫描覆盖 779 个跟踪路径、642 个文本文件，检测 provider/GitHub/AWS token、私钥标记、含凭据 URL 与较长的凭据赋值；只记录位置，不输出匹配值。

- 未发现真实 provider API Key、GitHub/AWS 凭据或被跟踪的 `.env`/私钥文件。
- 1 处 PRIVATE KEY 标记是诊断脱敏测试的假字符串；4 处较长赋值是 Control Server/R4/R3 的测试凭据样例。
- **9 处历史日志包含本地页面操作令牌**，并带回环 URL。它们属于历史测试服务，不是模型 API Key；本轮没有确认令牌有效性，也没有按用户已接受的历史风险修改日志。
- 本机路径和运行证据仍在历史文件中。用户接受保留，不等于这些文件已经经过完整隐私清理；公开时仍会包含已跟踪内容。
- 当前 `run-logged` 通过 DiagnosticOutput 在落盘前脱敏。新 `.env`、`.env.*`、pem/key/p12/pfx 规则加入 gitignore；模板 env.example/env.sample 可跟踪。已跟踪历史文件不受新增忽略规则保护，提交前仍需检查 staged diff。

字体 OFL 和 Lucide 许可证保留。有限文本扫描无法判断任意业务秘密，也未对所有截图进行人工审查。原始位置结果在 `.canary/logs/verification/open-source/current-files-scan.json`。

## 最后值得打磨的功能

以下是基于现有源码的优先级建议，**尚未作为本轮新增产品功能实现**：

1. **P1：执行失败必须给出可操作原因。** `check-executor` 的进程启动错误目前可返回 environment/blocked 但 stdout/stderr 为空；应保留脱敏的错误码、入口和建议，区分不存在命令、Windows .cmd、权限、准备失败。这次 README 初始失败就是可重复实例。
2. **P1：问题页的分类与证据更具体。** 现有 `project-issues` 以检查 category 和通用 advice 为主；优先完成 R16 的错误解析和可追溯归组，保留原始失败及未知项，让用户知道下一步检查哪里。
3. **P1：覆盖指标明确属于哪个检查和源码范围。** 普通 command 当前不产生全仓覆盖；函数 Agent 只覆盖声明范围。保持来源、分母和 unknown 的醒目表达，随后按 R20 接入报告。不要用测试通过代替覆盖证据。
4. **P2：地图大项目默认聚焦。** 现有导航/上下游过滤继续保留，默认先呈现变更、失败或选中模块；让解释路径、unknown 和连线范围易懂，避免把潜在影响解释成实际故障。不要为开源重做全套视觉。
5. **P2：复现与修复证据分级。** 目前已有同一检查关联重跑；完整隔离复现与相同回归测试前败后过仍按 R18/R19。按钮和文案应匹配当前证据强度。
6. **P2：安装与包元数据一致性。** 安装器只检查 Node 主版本 ≥22，而 ESLint 10 需要 22.13+；本轮首次使用统一建议 Node 24，后续可收紧源构建预检。Control Plane exports 把 default 放在 types/import 前，工具已给出顺序警告；后续应整理包元数据，不把它冒充当前功能失败。

额外安全边界：本地页面 GET 可返回操作令牌，应作为可信本机工作台，不作为远程鉴权服务。`exporter-core/src/spool.ts` 在未传 key 时使用公开固定默认值派生加密密钥；本轮未找到主流程实例化，因此不是默认报告流程的已证实泄漏。若启用该可选能力，需显式密钥/安全密钥管理及分享边界，不能用默认值宣称保密。

建议最终打磨先落 P1-1 与 P1-2；其后继续 R16 主线。PR 平台化、模型自动修复、长跑和跨平台补验不增加为本轮发布前强制任务。

## 验证与未覆盖范围

本地构建通过；Vitest 4 的全工作区测试通过（CLI 138、Web 41），控制面排除编译测试后定向 28 项通过。lint 通过；冻结 lockfile 的离线安装与严格 peer 检查通过。README 示例 Schema 和真实执行通过；文档格式、链接与 diff 检查在收尾验证。

没有运行远端 CI、付费模型、原生 Ubuntu/macOS 或长期收益实验。历史 R0–R15 记录保留各自版本和日期，不因为依赖升级自动扩大验收范围。回退依赖变更需同时恢复 package.json、workspace override、lockfile 与相关 Vitest 配置；不删除用户产物。
