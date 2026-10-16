# Project repair memory

Retain verified repair facts and retrieve relevant history for a later failure in the same project. Memory is advisory evidence; it does not apply a patch, change checks or establish that a new failure is repaired.

## Record a verified repair

Complete [repair verification](repair-verification.md) with a regression that passes after the fix and fails on the original production source. Then record the sealed candidate:

```sh
canary memory record <candidateRunId> --actor maintainer --reason "Reviewed regression evidence" --days 90
canary memory list --json
```

Recording rechecks the three run identities, retained execution/source evidence, original checks, regression files and repair receipt. `--days` accepts 1–365, default 90. If the repair receipt requires advisory review, review it before explicitly adding `--ack-review`. An unverified candidate or a passing test alone cannot become repair memory.

Source proofs must bind the same project scope across all three runs. Missing or differently scoped regression source proof requires fresh compatible evidence. This includes historical nested-project receipts that recorded a repository scope instead of the selected project's scope.

Records live in the project's ignored `.canary/memory/` directory. They contain structured check categories, reported paths, Git scope and receipt identities, with an operator and reason. Raw logs, patches and generated instructions are not stored as memory. Keep operator text free of credentials and personal information.

`list` returns at most 32 record summaries, with up to four check IDs per summary and explicit omission counts. Full records remain subject to the 64 KiB record limit.

## Query a later failure

```sh
canary memory query <failedRunId> --check <checkId> --max-items 5 --max-chars 8000
```

Repeat `--check` to select retained failed/blocked project checks. Defaults are 5 items and 8,000 context characters; limits are 1–10 items and 512–32,768 characters. Encoded query responses are bounded to 64 KiB. Omitted and skipped records remain explicit.

`total` is the number of stored records. `omitted` counts records not shown because of context, item or evaluation budgets; `skipped` also reports ineligible records such as expired, revoked or mismatched history. Increasing a budget cannot restore an ineligible record.

A query shares a 15-second evaluation budget and reads at most 32 MiB of historical JSON, with an 8 MiB limit per artifact. It evaluates at most 20 historical repairs; budget omissions remain visible instead of becoming a complete-history claim.

- **`related`**: the declared check, failure category, reported location and retained source scope match the selection, together with the recorded runtime, platform, tool versions, lockfiles and environment identity.
- **`needs-revalidation`**: historical evidence is valid, but source, ancestry or failure-location conditions differ or are unknown.
- **`unavailable`**: a reliable query could not be completed. Counts are unknown, not zero.

Both match states describe history. Neither proves a fix for the selected failure. Expired, revoked, corrupt, foreign-project and unverifiable evidence cannot be returned as a related repair. Moving a checkout to a different project root does not automatically transfer its memory identity.

The workspace's **Issues & improvements → Historical repairs** section queries only when requested. Refresh rechecks retained evidence; language changes redraw the existing result. Source, candidate and regression runs link back to their original checks. The page and the MCP `canary.memory` tool provide read-only lookup with no recording or revocation actions.

## Revoke a record

```sh
canary memory revoke <memoryId> --actor maintainer --reason "Superseded repair"
```

Revocation retains its operator, reason and time; it removes the record from future matches. Listing does not grant reuse permission. Project memory is separate from the [reviewed Agent experience workflow](r8-project-experience.md): no activation, Skill installation or automatic prompt injection occurs. Hashes establish document consistency, not authorship or execution authorization.

中文：项目修复记忆只保留有真实回归证据的结构化事实，按项目、检查、失败类别与源码范围检索。录入和撤回需要明确操作者与原因；页面及 MCP 只读。历史相关不等于本次已修复，条件变化标记为需重新验证，缺失证据保持不可用。
