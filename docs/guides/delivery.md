# Delivery and integrity

Canary uses GitHub source and Releases with Node.js 24. Installation builds the selected source version; no npm publication or account is required.

## Published stable source

The default installer resolves GitHub's latest published, non-prerelease stable Release. Its version, release URL, tag commit and built CLI version must agree. Annotated tags are resolved to their commit. Unpublished tags are not selected; unavailable metadata stops the operation without selecting `main`.

Release requests use the public GitHub API without importing credentials. Verification shares a 10-second deadline and limits each response to 1 MiB. Explicit `CANARY_REF` and `CANARY_CHANNEL=main` select trusted development source separately from the stable channel. Custom source repositories require an explicit ref or main channel.

The setup and CLI upgrade entry points enable [Node's system certificate store](https://nodejs.org/docs/latest-v24.x/api/cli.html#--use-system-ca) while preserving TLS verification. Direct script invocation can use `node --use-system-ca`; configured proxy or additional CA settings remain under the operator's control. Stable metadata uses the [GitHub Releases API](https://docs.github.com/en/rest/releases/releases#get-the-latest-release).

## Inspect and update

```sh
canary installation --json
canary installation --verify --json
canary upgrade --check --json
canary upgrade
canary upgrade --rollback
```

`installation` reads registration; `--verify` checks its inventory. The update check reads the published version without cloning, building, locking or changing files. Its versioned JSON has `mutation: false` and reports one of:

- `update-available`: a newer stable version is available.
- `up-to-date`: installed version and commit match the published Release; use inventory verification to check installed bytes.
- `ahead` or `version-conflict`: stable upgrade refuses an accidental downgrade or a different commit with the same version.
- `pinned` or `development`: the selected channel is preserved; the stable Release is informational.
- `not-installed`: no installation is registered.
- `unavailable`: metadata or the release service could not be verified. This is not an up-to-date result.

Pinned and working-tree installations need an explicit `CANARY_REF` or `CANARY_CHANNEL=stable/main` before changing their selection. Same-version, same-commit stable upgrades verify the runtime and return `unchanged` without rebuilding.

## Runtime inventory

New registrations bind a SHA-256 inventory to `packages/`, `apps/web/`, `scripts/`, `node_modules/`, the official `integrations/skills/canary-verify/` package, and the root package, workspace, lock and base TypeScript declarations that exist at installation. Every ordinary file's relative path, size and hash is retained, together with internal link targets. Additions, removals and content changes invalidate verification.

The inventory is limited to 30,000 entries, 1 GiB of ordinary-file bytes and a 4 MiB manifest. Links cannot escape the installation. Declared pnpm optional dependencies may have missing internal targets; their missing state is recorded explicitly and must remain unchanged. Other missing links are rejected. The summary reports missing optional links separately.

The inventory lives at `.canary-runtime.json` in the installed version directory. It covers the selected trees, excluding Node itself, operating-system libraries and external project services. It detects changes relative to registration; it is not a publisher signature or an execution sandbox.

## Recovery

An upgrade builds an independent version directory before changing launchers or registration. Failed source preparation or validation preserves the active installation. One prior registration is kept; rollback verifies its inventory before invoking that runtime. Legacy registrations without an inventory use their recorded CLI-file hash and can be upgraded to acquire the new inventory.

Project source, project artifacts and the official Skill ownership records are separate from the global runtime. Upgrading Canary does not update a managed project Skill; use `canary skill update` explicitly.

中文：稳定通道只选择正式发布的版本，并核对 tag、commit 和构建版本。更新检查只读，固定版本不自动换通道，重复版本不重建。安装清单绑定运行文件、依赖与内部链接；回滚先校验再执行。清单证明内容一致性，项目检查、项目证据和 Skill 更新分别管理。
