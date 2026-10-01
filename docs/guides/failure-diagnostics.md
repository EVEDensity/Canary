# Unified failure evidence / 统一失败证据

Inspect a failed check in the workspace drawer or run `canary diagnostics <runId>`. Both use the same structured diagnosis. Existing JSON, Markdown and JUnit reports remain compatible.

在页面检查详情中查看统一失败证据，或执行 `canary diagnostics <runId>`。页面和 CLI 使用同一诊断模型，既有 JSON、Markdown、JUnit 报告保持兼容。

Export / 导出：

```bash
canary diagnostics <runId> --out diagnostics.json
canary diagnostics verify diagnostics.json
```

Export requires a sealed, verified run and refuses to overwrite files. The bundle includes redacted original evidence, failed assertions, reported stack positions, run ID/start time, recorded commit/runtime, commands, working directories and required environment names. It omits environment values and credentials. SHA-256 and byte lengths check completeness and corruption, not who produced the package. Verify returns exit code 0 on success and 1 on failure.

导出要求运行已封存且通过完整性检查，不覆盖已有文件。包内保留脱敏原始错误、失败断言、堆栈位置、运行身份、已记录的 commit 与运行环境、命令、工作目录和所需环境变量名称，不包含环境变量值和凭据。SHA-256 与字节长度用于校验完整性，不能证明来源身份。校验成功退出码为 0，失败为 1。

Source positions are reported `path-line` evidence, not verified source maps. The page loads source through hash verification; absent snapshots or mismatching source remain unavailable. Missing positions are labeled `missing`; root causes are `unknown`. Only explicitly recorded dependencies associate failures; a prerequisite explanation is a `hypothesis` requiring confirmation. Similar messages alone never establish a relationship. Older reports without runtime or dependency metadata remain readable with explicit limitations.

日志位置标记为 `path-line`，不视为已验证的源码映射。页面通过源码哈希检查读取片段；缺失快照或哈希不匹配时显示不可用。缺失位置标记为 `missing`，未确认根因标记为 `unknown`。仅通过已记录的显式依赖关联失败；前置失败解释标记为 `hypothesis`，需要确认。不会仅凭类似错误文本关联失败。旧报告缺失运行环境或依赖元数据时仍可读取，并明确显示限制。

Follow the package's next steps: inspect original evidence, restore the recorded context, confirm the location, repair the failing behavior and rerun the same check. Truncated logs are labeled; the package cannot recover discarded output.

按包内下一步说明处理：阅读原始证据，恢复记录的运行上下文，确认源码位置，修复并重跑同一检查。已截断日志会明确标记，诊断包不能恢复已丢弃的输出。
