# 项目经验操作指南

本流程只在当前项目内运行。`experience propose-project` 从已校验的失败项目运行提出候选；固定规则生成建议正文，错误日志仅以哈希作证据。普通 command 检查的历史对比只证明观察到改善；要证明经验在下一轮实际起作用，须选择包含失败 Agent case 与独立 holdout 的项目检查，执行 soft-trial。

## 1. 生成候选与定位来源

```powershell
canary run --ci
canary experience propose-project <失败项目运行ID> --check workspace.agent
canary experience list
```

候选处于 `proposed`。记录包含来源 run/check、manifest 与错误证据哈希、项目与 case 作用域、固定建议、限制和验证要求。重复生成相同来源与范围的候选会复用版本。也可用 `canary experience compare-project <baseline> <candidate> --regression <检查ID> --holdout <检查ID>` 比较项目检查，但该报告的经验归因保持 `unverified`，不能代替下面的独立试验。

## 2. 独立回放

从失败项目运行的 `run.json` 找到 Agent 检查的 `checks[].childRun.runId`。使用该子运行作为基线，并传入对应的 Agent 配置：

```powershell
canary soft-trial prepare <失败子运行ID> --experience <候选经验ID> --regression <失败caseID> --holdout <独立caseID> --config agent.config.ts
canary soft-trial validate <trialID> --config agent.config.ts
```

回放必须在隔离目录里将候选送达 function 适配器上下文，改善 regression、保留 holdout、通过硬门禁，且记录各次执行的送达引用。来源项目运行与子运行的 manifest、项目根目录、case 作用域和数据集身份均须匹配。只记录选择不能满足送达要求，旧记录缺少送达证据时不能补推为已送达。验证失败会留下 rejected/原因，不能进入批准。`soft-trial run` 在批准前会拒绝执行。普通项目候选不能用 `experience validate/activate` 绕过试验；项目候选的直接 `soft-trial approve/rollback` 也被拒绝。

## 3. 人工批准与实际加载

先检查 `canary control status`、`canary control revision soft.approve <trialID>` 和页面“项目经验 Experience”中的来源、收益、回归及适用 case。批准命令需独立填写操作者、理由、唯一请求 ID 和刚取得的 revision：

```json
{
  "action": "soft.approve",
  "target": "<trialID>",
  "expectedRevision": "<上一步revision>",
  "requestId": "<唯一请求ID>",
  "actor": "<操作者>",
  "reason": "<审阅的证据和批准理由>"
}
```

将 JSON 保存为项目内临时命令文件，再运行 `canary control act --file <命令文件> --config agent.config.ts`。批准会重新核对基线、候选、经验身份与正文哈希、数据集身份、验证结果，并记录 actor/reason。随后执行：

```powershell
canary soft-trial run <trialID> --config agent.config.ts
canary run --ci --config canary.project.json
```

第一条显式激活并保存此前 active pointer；第二条创建真实项目检查的 Agent 子运行。核对运行 `run.json` 的 `experiences[].selection`、`experiences[].delivery`、每次 `results[].experienceDelivery`、项目检查的 `childRun` 和 manifest。只有 `delivery.status: delivered`、匹配的 case/execution IDs、版本/正文哈希及送达时间共同证明 function 上下文送达。经验仅在匹配项目、检查与 case 且满足条目数/字符预算时选择。`experience load` 可诊断选择和跳过原因，但只查询元数据，不证明一次运行实际送达。

## 4. 导出 Skill 草稿与回滚

```powershell
canary experience export-skill <经验ID> --config agent.config.ts
canary control revision soft.rollback <trialID> --config agent.config.ts
```

导出只接受验证有效、内容哈希完整且有当前批准证据的项目经验。输出在项目 `.canary/skill-drafts/<name>/`，包含 `SKILL.md` 与带哈希的 `draft.json`；相同输入可重复生成，内容不同不会覆盖现有文件。草稿不会安装，也不会覆盖用户全局 Skill。草稿是审阅材料，不会自动赋予工具或源码权限。

回滚同样通过 `canary control act --file <命令文件>`，把 action 设为 `soft.rollback`，target 为 trial ID，使用刚取得的 revision、新请求 ID、actor 和 reason。控制面检查当前指针仍为本试验激活的版本，才恢复保存的精确旧指针；并发变动时拒绝覆盖。回滚后下一次运行应不再加载该经验。已导出的草稿文件仍是审计副本，但不代表当前授权；回滚后再次导出会被拒绝。用 `canary control audit` 查看操作及失败记录。

## 页面与安全边界

function 子进程将所选条目作为 `context.experiences` 传给 Agent，并返回匹配引用的送达确认。`selected` 表示选择已完成，`delivered` 表示实际传入函数上下文，`unsupported` 表示当前 HTTP/MCP 适配器不注入这类经验。送达确认不证明 Agent 阅读、采用建议或产生模型收益；收益仍须按固定 regression/holdout 的独立试验评估。普通 command 检查不注入经验。

子进程 stdout/stderr 有限量、脱敏与截断标记；原错误保留为证据，日志和工具输出不能变成执行指令。项目经验记录和 active pointer 的损坏会明确阻止读写与状态变更，不能静默当作空状态覆盖。批准、回滚与导出仍沿现有控制面审计，不授予额外源码、凭据、网络或合并权限。官方验证 Skill 的安装更新入口见 [Skill 指南](skills.md)，和本节经验草稿是不同交付物。
