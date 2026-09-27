# R8-05 至 R8-09 执行与阶段审计

日期：2026-09-24。代码起点：`77f34f06661c94137c7d7cdae40730f74779f176`（R8-00 基线）；R8 代码及文档最终合入 `a1dd89fff3fbaa74ee66c394ff7bbad14693e5a3`，后续策略文档位于 `4fdb24d84f20496874bc308b6218fd4eda4759f8`。原始验收在提交前的同一工作树执行；R9-00 的干净 checkout 复核另见 [R9 记录](r9-00-01-execution.md)。环境：Windows、Node 24.18.0、pnpm 10.15.0。前置 R8-01 至 R8-04 的代码与证据见 [前段执行记录](r8-01-04-execution.md)。本记录的完成范围限于本机固定函数 Agent fixture；不代表真实模型普适收益或三平台认证。

## 实现与所有者

- R8-05：`packages/control-plane/src/index.ts` 复用 S-04 的试验/指针和控制面操作。项目候选必须有已验证父/子运行、匹配回归 case、独立 holdout、实际加载引用、无回归的比较，再由操作者带 actor/reason/revision 批准。批准证据绑定基线、候选、经验身份与正文、数据集和验证结果哈希；缺失或篡改时拒绝运行/导出。激活保存旧指针；回滚只在当前指针仍为本试验版本时精确恢复。`packages/cli/src/index.ts` 阻止项目候选绕过控制面直接批准/回滚。
- R8-06：`packages/cli/src/index.ts` 提供 `experience export-skill`。只导出已独立验证并获有效批准的项目经验，项目内 `.canary/skill-drafts/` 保存有哈希的 Skill 草稿与元数据；重复导出字节相同，发生差异拒绝覆盖，不安装全局 Skill。
- R8-07：`packages/control-plane/src/index.ts` 提供经过裁剪的经验/试验投影；`apps/web/src/control-client.ts`、`control-ui.ts`、`control-styles.ts` 提供“项目经验 Experience”视图、来源与适用范围、收益/回归、实际加载记录，以及批准、拒绝、停用、回滚入口。写操作沿用控制面 token、角色、理由和 revision。页面不返回经验正文或原始日志。
- R8-08：`packages/cli/tests/r8-closure.test.ts` 和 `scripts/verify-r8.mjs` 使用真实项目检查子进程和本地函数 Agent。`packages/trace/src/artifacts.ts` 修复 Windows 短路径/长路径别名导致父运行误判的 manifest 校验。`packages/cli/src/check-executor.ts`、`project-run.ts`、`app.ts`、`ci.ts`、`index.ts` 将匹配的项目检查 ID 传给 Agent 子运行，保证批准经验在真实项目运行中实际选择。
- R8-09：本记录、[操作指南](../guides/r8-project-experience.md)、[Schema 与信任边界](../guides/r8-schema.md) 及路线图状态完成收口。

## 固定真实闭环证据

执行 `pnpm verify:r8`，日志：`.canary/logs/verification/r8/2026-09-24T15-58-49-844Z-cd31732d/`。保留的项目 fixture：`.canary/verification/r8/canary-r8-closure-yVXvow/acceptance.json`。fixture 有 `broken` 和独立 `holdout` 两个 case，不访问网络或模型。

1. 基线项目运行 `run_3ada38af-e3df-4eb0-b421-f388ea840457`：`broken` 失败，父/子 manifest 均 verified，父运行记录 Agent 子运行 ID。
2. 错误作用域候选 `experience_project-workspace-agent-wrong-scope_1_75cf2927743a` 在 prepare 被拒，原因是 regression 不在候选适用 case 且 holdout 必须独立；`r8_negative_rejection` 又以操作者及理由正式撤销候选，页面状态为 `revoked`。正确候选 `experience_project-workspace-agent-inspect-assertion_1_75cf2927743a` 只适用于 `broken`。
3. `soft_trial_54a8ce1b-36b8-4537-964e-08d6160a9475` 对基线子运行做隔离回放，候选运行 `run_b8e8b3a4-5b89-4575-9acb-297b9df716c6` 显示 regression 改善、holdout 无回归，且候选只加载到 `broken`。批准前的运行和直接 CLI 批准被拒。
4. 控制审计 `r8_approval` 记录 `operator` 和“regression and holdout evidence reviewed”。获批后的 `run_632b2c36-fab6-4054-9481-509e111c781d` 实际加载候选。再执行项目 `run_293d5964-1ca4-4070-bfd3-615bb2fdfde5`，Agent 子运行也实际加载并通过。导出的 Skill 草稿通过 `skill-creator/scripts/quick_validate.py`：`Skill is valid!`。修改现有草稿后再次导出被拒，恢复原字节后继续验收。
5. 控制审计 `r8_rollback` 恢复空旧指针；回滚后项目运行 `run_b976dbf4-f97d-41cf-b625-e728a2656eaf` 再次失败，其 Agent 子运行加载列表为空。回滚后再次导出被拒，所有相关 manifest 仍 verified。fixture 源文件合并 SHA-256 为 `2b615f31f71b9b77a599aaa983fa1ad8a4927c19cb0b06fe29033feaa0352e5a`，前后字节不变；模型调用数为 0。

控制面页面使用同一固定流程的保留 fixture 的只读本地服务实际打开，能看到两条候选、来源 run/check、适用 case、最近加载、试验的 `improve`/无回归和已回滚状态。最终 fixture 另外核对错误候选的 `revoked` 投影。该浏览器验收仅检查页面呈现；可写权限下的动作通过同一控制面 API 的闭环与单元测试验收，不宣称做了浏览器人工点击批准。

## 验收与负面检查

- `pnpm build`、`pnpm verify:r8` 通过；`pnpm check` 覆盖全仓 typecheck、test、lint、format:check，最终全仓测试日志在 `.canary/logs/tests/2026-09-24T16-00-04-394Z-3e541dc9/`。旧 S-04 的 29 个 CLI 回归用例另行串行运行并全部通过。
- 控制面单元测试证明批准后基线/候选篡改、数据集身份或 actor/reason 改动均会让批准失效；旧指针恢复要求无并发变化。CLI fixture 验证缺少控制面批准文件、错误候选、批准前运行、直接 CLI 批准/回滚、回滚后导出均被拒。
- 新 UI 测试检查导航和脚本；闭环测试检查页面投影只包含诊断元数据、没有经验正文。原 R3 的敏感信息与半写入测试仍在全仓检查内；本 fixture 未注入真实凭据。
- `git diff --check` 检查源码差异空白错误。测试与运行日志都在项目 `.canary/` 并由 `.gitignore` 排除。

## 阶段一致性审计

1. **本地优先与外发**：固定 fixture 与页面仅在本机运行，模型调用 0；没有新增自动网络发送。
2. **输入、凭据、holdout 暴露**：页面只暴露脱敏后的来源元数据、哈希、case ID 和比较结论；不暴露经验正文、原始日志或凭据。holdout case ID 用于审计，不把其输入注入经验。浏览器操作 token 由环境变量提供。
3. **根目录**：所有经验、trial、Skill 草稿和日志绑定 `projectRoot`，项目内路径不从 `installRoot` 推导；跨目录/跨项目匹配被拒。
4. **状态准确性**：R8 最小本机闭环为 verified；真实模型长期收益、macOS 和原生 Ubuntu 仍未由本轮验证。R6 跨平台余项保持 blocked/延后，R7 长跑保持暂缓，生产级总判断不变。
5. **生态边界**：本轮只证明函数 Agent fixture 与现有控制面；不宣称 Pi、其他宿主或完整 Skill 生态已通过 R8 闭环。
6. **循环语义**：不会自动提案、批准、激活、安装 Skill 或启动常驻演进；所有生效操作显式执行。
7. **失败恢复与审计**：拒绝与控制操作均有结构化状态和审计，激活保留旧指针并可精确回滚；现有 R1/R3 测试覆盖超时、取消、崩溃及 artifact 完整性。本轮 fixture 未重新跑真实进程崩溃注入，不把它列为新增 R8 证据。
8. **维护范围**：复用单一经验存储、S-04 soft-trial、控制面和 manifest；新增一个固定 fixture 与一个操作视图。没有新远端服务或第二套状态机。

未覆盖：多小时收益/容量长跑、真实模型因果收益、多 provider/宿主、macOS/原生 Ubuntu、自动安装与源码补丁、远端同步。人工回滚命令与并发失败处理见操作指南；如需撤销本轮代码，可回到起点 commit 并保留项目 `.canary/` 证据归档，历史 artifact 不作批量改写。
