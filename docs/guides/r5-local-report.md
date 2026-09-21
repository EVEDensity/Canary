# R5 本地项目报告

默认在最近配置目录优先选择 `canary.project.json`，显式 `--config` 可覆盖。`canary.project` 配置的普通 `run` 在检查开始前启动回环页面。项目与 Agent 运行共用工作台，根据运行类型展示对应数据。项目检查配置见 [R4](r4-project-checks.md)。

```sh
canary run --config canary.project.json
canary run --config canary.project.json --no-open --port 4318
canary run --config canary.project.json --artifacts-only
canary run --config canary.project.json --ci
```

`--no-open` 保留服务但不打开浏览器；端口 0 自动分配。`--headless`、`--artifacts-only`、`--json` 或配置 `web.enabled: false` 不启动服务。CI 始终无页面。配置可设置 `web: { host: "127.0.0.1", port: 0, open: false }`；仅接受回环主机。

## 页面与运行生命周期

“改进建议”展示问题汇总、分类、错误摘要和证据定位。修复后点击“重跑验证”，会新建独立运行并重新执行依赖；回到来源运行可以看到关联验证结果。只有配置、谱系和封存证据一致，且目标检查及必需依赖通过，才显示“重跑已验证”。该状态不改写原始失败，也不代表来源运行的其他问题全部解决。

日志采用有界、先脱敏的错误上下文保留；检查详情和抽屉可查看开头、错误附近与末尾内容。旧运行已经省略的日志无法恢复。损坏、半写入或未封存的验证证据不会显示为通过。实现与验收见 [问题闭环记录](../evidence/project-issue-closure.md)。

页面展示 SSE 实时检查进度、当前检查、完成项的有界脱敏日志、错误分类、固定排查建议、项目历史、逐项比较，以及 JSON/JUnit/Markdown 报告。日志在检查完成时更新，不直接转发原始 stdout 分片，以保持现有脱敏边界。建议不会自动执行。

关闭浏览器不影响检查或服务。点击“停止页面服务”只关闭 HTTP/SSE，当前检查继续完成并封存证据。终端 Ctrl+C 会取消当前检查并关闭服务，沿用 checkpoint/取消审计。初始运行结束后服务继续存在，直到显式停止；CLI 退出码对应初始完整运行，页面重跑的结论属于各自新 artifact。

“重跑失败项”选取失败/阻塞项；“单项重跑”选取一项。二者都会重新执行依赖，创建新 runId，记录 retryOf 和父 manifestHash。明确重跑的子集全部计入该次门禁，包括原本可选的项。原运行不改写，不自动循环。运行期间拒绝并发重跑，未封存或损坏的证据不能作为重跑来源。

会话使用启动时的配置；历史运行必须匹配当前配置或其已有子集。修改配置后请重新启动会话。历史仅来自当前 projectRoot 的 artifact 集合。比较将未选择的检查显示为“未运行”，不会当作通过。

## 可选诊断

HTTP 健康检查、只读 Docker inspect 沿用 R4 的显式授权配置。新增资源检查：

```json
{
  "id": "capacity.local",
  "type": "resources",
  "required": false,
  "minFreeMemoryMb": 512,
  "minFreeDiskMb": 1024
}
```

记录可用物理内存和项目所在文件系统可用磁盘，单位 MiB；低于门槛产生 assertion。默认不添加额外检查，CI 与普通 run 使用同一配置和判定。资源值是采样时快照，不是配额或持续监控。

## 信任与证据

仅监听 loopback；校验 Host 和 Origin；重跑和停止服务必须携带本次页面的写令牌。页面使用 textContent 展示项目值，不加载远端资产。API/报告继续经过 R3 脱敏和完整性校验。回环服务不提供多用户操作系统隔离；受信任的检查命令仍具有原来的本地执行权限。

验收范围、实际命令和未覆盖项见 [R5 执行记录](../evidence/r5-execution-record.md)。
