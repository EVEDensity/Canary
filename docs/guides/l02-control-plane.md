# L-02 控制面操作指南

## 启动与权限

从仓库根目录运行 `pnpm canary control serve --port 4318`，默认只读。若环境已有 CANARY_CONTROL_TOKEN，先用 `Remove-Item Env:CANARY_CONTROL_TOKEN` 清除它。

需要写权限时在 PowerShell 显式启动：

```powershell
$env:CANARY_CONTROL_TOKEN = node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
pnpm canary control serve --port 4318
```

在浏览器输入该环境变量的值解锁。凭证至少 32 字符，仅保存在浏览器内存，不放入 URL 或持久存储。停止服务后清除环境变量。actor 是审计声明，不是独立身份认证。不要将 loopback 服务反向代理至公网。

## CLI 与版本绑定

- `pnpm canary control status`：脱敏状态、指标、操作与当前修订。
- `pnpm canary control audit`：持久化审计。
- `pnpm canary control revision <action> <target>`：读取指定资源修订。
- `pnpm canary control act --file <command.json>`：显式执行完整命令。

下面是可直接运行的命令生成示例，仅生成文件、不执行审批；没有可用证据时明确停止：

```powershell
$status = (pnpm --silent --filter @canary/cli exec node --import tsx src/index.ts control status | Out-String | ConvertFrom-Json)
$action = $status.actions | Where-Object { $_.action -eq 'anchor.create' } | Select-Object -First 1
if (-not $action) { throw '没有可建立锚点的运行，请先完成本地评估。' }
$command = @{
  action = $action.action
  target = $action.target
  expectedRevision = $action.revision
  requestId = 'manual_' + [guid]::NewGuid().ToString('N')
  actor = [Environment]::UserName
  reason = '人工审阅完成，建立固定质量观察锚点'
  threshold = 2
}
$command | ConvertTo-Json | Set-Content -Encoding utf8 .canary/l02-command.json
Get-Content .canary/l02-command.json
```

审阅后运行 `pnpm canary control act --file .canary/l02-command.json`。这只建立锚点和审计，不启动模型。相同 requestId 与请求体返回原完成回执；同 ID 不同内容被拒绝。修订过期需重新审阅并生成新请求。

## 指标与安全语义

缺失、未完成、Judge 错误、stub 或低置信度显示不可用，不按零分或通过处理。漂移相对固定锚点计算，通过率差使用百分点；Agent 自述不是独立质量证据。保留集轮换要求独立身份，泄漏审计记录哈希、人工声明与可观测重叠，不能证明系统外不存在泄漏。活动源码版本是应用日志历史，不证明当前磁盘未被后续修改。

软审批重新验证比较结果、独立试验、保留集和经验内容。硬审批重新校验授权、策略和证据；HTTP 没有直接应用源码端点。硬回滚拒绝覆盖后续用户改动。停止/撤销在异步安全边界生效，不能取消已发生或已经在途的外部副作用。

## 崩溃与 pending 恢复

1. 停止所有写入者，核对 `.canary/control-plane/write.lock` 中 PID，确认原进程已经退出。
2. 备份审计、日志及受影响状态，人工核对副作用是否已发生。
3. 仅确认锁陈旧后移除该锁；不要删除审计、盲目重放原请求或自动清空锁。
4. 通过 UI 的待决审计操作或 CLI 使用 `audit.reconcile`，目标为原 pending 审计 ID，绑定当前修订并记录核对结论。
5. 系统追加含原记录哈希的解决记录，不重放原副作用。刷新实际状态后才进行下一次独立决策。

## 边界与回滚

这是本地 OS 用户信任边界，不是多租户认证或 OS 沙箱。旧 CLI 写入者不共享控制面事务锁。停用专用服务即可撤下控制面；撤回代码时保留旧产物及 `.canary/control-plane` 历史。L-02 不自启循环、不调用付费模型、不进行生产部署；L-03 不在本次范围内。
