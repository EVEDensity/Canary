# R3 artifact 证据链

Canary 每次运行在 `projectRoot/.canary/artifacts/<runId>/` 创建 `manifest.json`。它记录 schema 版本、文件字节数、SHA-256、运行谱系和脱敏扫描状态。`coverage-manifest.json` 继续描述覆盖率源码范围，两份清单各有职责。

## 校验与状态

```bash
canary run --ci
canary verify <runId> --json
canary run --ci --retry-of <runId>
canary replay <runId> --headless --no-open
```

`verify` 输出单个 `canary.artifact-integrity` v1 JSON。只有 `verified` 返回 0；`legacy`、`partial`、`invalid` 和 `missing` 返回 5。`run --ci` 保持原有 v1 顶层 schema，artifact 错误返回 5，隐私门禁错误返回 6。

- `verified`：文件清单、字节数、哈希、运行身份、谱系及 manifest 历史链校验通过。运行是否通过由 `run.status` 和 CI 退出码表示。
- `legacy`：没有 R3 manifest 的旧运行仍可读取和展示，但不能作为已校验的新证据。删除带有 R3 evidence 标记的运行的 manifest 会被判为 `invalid`。
- `partial`：尚未封存的运行，包括正在执行或中断的运行。此时文件仍在变化，不进行最终文件哈希认证。
- `invalid`：文件丢失、修改、截断、额外文件、残留工作目录、历史链损坏、身份或谱系不一致。读取该运行、进行比较或追加派生结果会拒绝。
- `missing`：没有可读取的运行。

manifest 状态依次为 `partial` → `sealed`；恢复产生 `recovered`。封存前关闭 trace、释放子进程资源并移除 `tmp/`、`work/`，避免将临时原始数据保留为长期运行历史。活动锁不属于 artifact 内容清单。

JSON 快照使用同目录临时文件、文件同步和原子重命名。封存检查 JSON/JSONL 语法，残留 `.tmp` 文件不能被认证成完成状态。文件系统掉电行为和长时间运行容量仍由 R7 进一步实测。

## 追加结果与运行谱系

`ci.json`、`comparison.json`、`improvement.json` 和 `host-proposal.json` 等后续写入统一经过 artifact repository。写入前验证原清单，写入后更新清单；旧清单保存在 `manifest-history/<sha256>.json`，新清单记录 `previousManifestHash`。原证据已损坏时，写入不会重新计算哈希来掩盖损坏。

`run.json.evidence.lineage` 与 manifest 一致，支持 `replayOf`、`candidateOf`、`retryOf` 和 `recoveryOf`。新执行会绑定父运行当时的 manifest 哈希；旧格式父运行没有这个哈希。每个结果继续保留 executionId、caseId、repetition 和失败分类。

`--retry-of` 显式记录本轮重试来源；用例仍由当前配置和 `--case` / `--tag` 选择，不自动选择失败项或调度重试。失败项自动重跑和跨语言检查编排属于后续 R4/R5。

恢复保持已完成结果，不重新执行它们。只有 JSONL 最后一条未换行且未写完的记录可被截去，`recovery.json` 记录原文件哈希、恢复后哈希、截去部分的字节数和哈希。中间记录损坏、快照无法解析或已封存文件被修改时，保留失败证据并拒绝自动认证。

哈希链用于本地文件完整性和改写审计，没有引入签名或外部可信锚；它不能证明拥有整个目录写权限的对手没有重写全部文件和哈希。

## 脱敏路径

评估使用原始内存值，脱敏发生在输出边界，避免改变测试判定。

| 输出路径                                                              | R3 处理                                                        |
| --------------------------------------------------------------------- | -------------------------------------------------------------- |
| `run.json`、`coverage.json`、trajectory、evaluator、coverage manifest | 完整对象脱敏后原子写入，包含源码文本、建议、输入输出和嵌套事件 |
| `trace.jsonl`                                                         | 每条记录脱敏并排队写入；写入失败传递至运行失败                 |
| JSON / Markdown / JUnit / console 报告                                | 从脱敏快照渲染，文本输出再作识别模式过滤                       |
| CI 摘要和后续比较、建议、宿主 proposal                                | repository 写入并更新 manifest 历史链                          |
| Web 初始快照、HTTP、比较、报告和 SSE                                  | 输出前脱敏；已加载运行的磁盘证据损坏时 API 返回 409            |
| 控制面 HTTP JSON                                                      | 输出边界脱敏；不改变已有审批或执行语义                         |
| 恢复记录                                                              | 只记录哈希、字节数、状态和运行标识，不记录截去的原文           |

规则覆盖敏感键、Bearer、常见 token 前缀、JWT、私钥、URL 凭据和赋值形式的密钥。配置、用例和当前环境中由敏感键识别的值，也会在其他字段中被替换；用于值匹配的最短长度是 4。默认字段长度上限为 2048。普通 `token count` 文本不会因包含单词 token 被整段删除。

封存前额外检查结构化字段和文本。如果检测到漏过输出边界的内容，尽可能清除已识别的敏感值，生成只包含文件路径与前后哈希的 `privacy-findings.json`，并让本轮隐私门禁失败。该失败不会因后续恢复而变成通过。

这些规则覆盖可识别的凭据，不保证识别任意无标签、编码或拆分的秘密。配置、Agent 和依赖仍属于受信代码；R3 不增加 OS 沙箱。历史文件按读取时规则展示，默认不会批量重写旧文件。Web 自身的短期操作口令继续用于已有写接口授权，与被测项目的 API 凭据分开管理。

## 可复现元数据

```ts
artifacts: {
  reproducibility: {
    seed: 42,
    clock: "2026-01-01T00:00:00.000Z",
    envAllowlist: ["NODE_ENV"],
  },
  retention: { maxRuns: 100, maxAgeDays: 30, maxBytes: 536870912 },
}
```

Function Agent 可使用 `context.now()` 返回 ISO 时间，使用 `context.random()` 取得可重复随机序列。每次 execution 从所配置的 seed 开始。框架超时、运行时间戳、系统 Date/Math.random 和远程服务仍按实际运行处理。

`run.json.evidence.reproduction` 保存配置、选中用例、覆盖范围源码、依赖锁文件、Node/OS/架构和可取得的 Git commit 摘要。环境仅记录显式允许的变量名和整体哈希，敏感变量名会从该列表排除。不会把整个环境及其值落盘。

`conclusionHash` 对排序后的 case/repetition、是否通过、失败分类、断言结论和脱敏输出取哈希，排除运行 ID、轨迹 ID 和耗时。它支持比较固定 fixture 的等价结论，不代表所有事件和远程行为完全可重现。恢复改变运行状态后会清除旧 conclusionHash。

## 本地保留策略

```bash
canary prune --json
canary prune --apply --json
```

配置 `artifacts.retention` 后，第一条命令只生成计划，第二条才清理。没有配置时返回 2，不默认删除历史数据。支持运行数、年龄和累计字节数目标；保留运行的祖先、活动锁、旧格式及损坏证据受保护，清理前再次校验。

受保护证据导致目标无法满足时，计划返回 `withinBudget: false`。这些是历史清理目标，运行时硬磁盘配额、日志轮换、背压和长跑限制继续留在 R7。

Web 运行页显示完整性状态和谱系；也可查询 `GET /api/runs/<runId>/integrity`。实测环境和未覆盖边界见 [R3 执行记录](../evidence/r3-execution-record.md)。
