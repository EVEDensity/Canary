# Evidence archives and stable contracts

Canary archives a complete artifact collection: sealed runs, manifest history, quality decisions, improvement plans and their retained run dependencies. Every file is bound to an immutable archive manifest. Project source, operational logs, project memory and activated experiences remain separate.

## Review and archive

Run from the project, or add `--project <directory>`:

```sh
canary archive create .canary/archives/release-1 --json
canary archive create .canary/archives/release-1 --apply --plan-hash <contentHash> --actor maintainer --reason "Preserve release evidence" --json
canary archive show .canary/archives/release-1 --json
```

The default operation copies evidence and preserves the active collection. To free its record quota, add `--rotate` to both the preview and apply commands. Rotation moves the entire collection into the archive, verifies it, then creates an empty active collection. Records and dependencies move together; individual referenced runs are never discarded to satisfy a quota. Rotation requires source and archive storage on the same filesystem. Neither mode overwrites an existing archive.

Plans bind the collection, destination and mode. Apply requires the exact current hash, actor and reason. Changed, partial, linked, damaged or unscanned evidence and missing dependencies block the operation. Archives are bounded to 512 runs, 8,192 files, 4,096 directories, 32 MiB per file and 256 MiB total. A collection may contain up to 64 improvement sessions and 128 quality records.

## Restore

```sh
canary archive restore .canary/archives/release-1 --json
canary archive restore .canary/archives/release-1 --apply --plan-hash <contentHash> --actor maintainer --reason "Restore reviewed evidence" --json
```

Restore checks every file and reference before publishing to an absent or empty collection at the original project location. It preserves record bytes, manifest revisions, run identities, choices, consumed attempts and unknown metrics. Existing records are never overwritten, and the archive remains intact. Restore attribution is retained in the archive parent's `audit/` directory. Archived evidence is available to normal workspace and memory queries after restore; records outside the collection are not rebound automatically.

## Interrupted operations

Managed evaluations retain operation leases. Artifact, decision, improvement and retention writers enroll through the same maintenance barrier; archive operations reject active or interrupted work. Independent evaluations can still run concurrently. Close older Canary processes before maintenance so all writers use the current coordination protocol.

```sh
canary archive recover --json
canary archive recover --apply --plan-hash <contentHash> --actor maintainer --reason "Close the exited collection operation" --json
```

Recovery only releases unchanged collection locks whose owners have exited. It does not terminate a persisted PID, rerun work or reset an improvement budget. Use `improvement recover` separately for a charged improvement attempt. Live, unknown or corrupt ownership and a leftover maintenance-recovery guard remain blocked for inspection.

Interrupted publication leaves a `.pending_<id>` archive or `.restore_<id>` staging directory. A complete pending archive can be inspected and restored by its explicit directory after lock recovery. Incomplete bundles fail verification and cannot replace current evidence. Source evidence is preserved on a handled copy failure; a handled rotation failure attempts to move it back. These controls coordinate Canary writers and do not prevent arbitrary external programs from modifying files.

## Version 1 contract

The supported CI envelope retains exits `0` success, `1` failed checks, `2` configuration, `3` interruption, `4` environment/ownership, `5` artifact integrity, `6` policy/privacy and `10` internal error. Operating commands `archive`, `profile` and `improvement` use `0` for completed inspection/operation, `1` for a blocked or unsuccessful result and `2` for invalid input. Read-only output never grants Agent execution.

Core schemas validate profile stages, improvement recovery views, archive plans/manifests and existing quality/improvement records. MCP retains its documented tool list, protocols and startup opt-in for decision recording. Golden fixtures retain the v0.9 prepared and v0.10 interrupted record hashes; upgrading does not rewrite them. Null observations remain unknown. Unsupported schema versions, malformed records and unsealed legacy artifacts are not automatically converted into verified evidence. Breaking contract changes require a new schema version and explicit migration.

## Reproduce acceptance

```sh
pnpm build
pnpm verify:release
```

The deterministic six-case Agent fixture executes a failing baseline, records a choice, verifies the candidate and independent holdout, interrupts an actual owner process, closes its charged ledger, then archives and restores all evidence. Receipts and measured stage timings are retained under `.canary/verification/`; command logs use `.canary/logs/verification/release/`. These are fixed-contract observations, not production performance guarantees or evidence of model quality.

中文：默认只读预览，显式确认哈希后复制归档；`--rotate` 整套移动运行、决策及改进记录并腾出当前配额。恢复要求原项目的空集合，逐项核验后保留历史哈希与未知指标，不覆盖现有数据。中断锁需单独确认恢复；稳定接口与短闭环验收保持可复现。
