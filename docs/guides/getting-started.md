# Installation and setup

Prepare Node.js 24, Git, and your project's dependencies.

Canary is delivered through GitHub source and Releases. The installer builds a selected source revision; an npm publication or account is not required. Workspace tarballs are downloadable artifacts with workspace dependencies, rather than a standalone global install channel.

## Install

Windows / PowerShell:

```powershell
iwr -useb https://raw.githubusercontent.com/EVEDensity/Canary/main/scripts/install/install.ps1 | iex
```

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/EVEDensity/Canary/main/scripts/install/install.sh | bash
```

## Run

Open a new terminal and run from your project or any subdirectory:

```bash
canary run --ci
canary run --port 4318 --no-open
```

The report opens at `http://127.0.0.1:4318/`. From another directory, use `canary run --ci --project <directory>`.

Automatic discovery uses existing project scripts and supported language test entry points. Add [configuration](r4-project-checks.md) for custom commands or execution requirements.

## Diagnostics

```bash
canary version --json
canary paths --json
canary doctor --json
canary installation --json
canary installation --verify --json
```

See [automatic checks](automatic-checks.md), [support scope](support-matrix.md) and [troubleshooting](troubleshooting.md).

Install the project verification Skill with `canary skill install`, and inspect it with `canary skill status --json`. See the [Skill guide](skills.md), [CLI verification](cli.md) and [MCP host integration](mcp.md).

## Releases and upgrades

The installer verifies GitHub's latest published stable Release and its tag commit before building. Drafts, prereleases and unpublished tags are excluded. A network or verification failure stops installation without falling back to development code. Set `CANARY_CHANNEL=main` for development builds, or `CANARY_REF` for an explicit tag/commit.

```bash
canary upgrade --check --json
canary upgrade
canary upgrade --rollback
```

The update check reads published release metadata without cloning, building or changing registration. Stable upgrades skip identical versions/commits and reject accidental downgrades or same-version commit conflicts. Pinned and working-tree installations require an explicit `CANARY_REF` or `CANARY_CHANNEL` to change channels.

Each installation is built in an independent version directory. Launchers and registration change only after validation; a failed upgrade retains the active version. One previous registration is retained for rollback. New installations record a complete inventory of the selected runtime trees; rollback checks it before starting the previous runtime. `canary installation --verify` checks the recorded files, dependencies and internal links without modifying them. Legacy installations without an inventory retain the older CLI-file check until reinstalled.

See [delivery and integrity](delivery.md) for inventory scope, limits and update statuses. These checks establish consistency with retained metadata, not a publisher signature. Existing source checkouts, project files and evidence are preserved.

中文：默认核对正式稳定 Release；`canary upgrade --check --json` 只读检查更新。升级失败保留原版本，重复版本不重建，固定版本不隐式切换通道。`canary installation --verify` 检查安装清单，回滚在执行旧版本前核验其内容。

## Build from source

```bash
git clone https://github.com/EVEDensity/Canary.git
cd Canary
pnpm install --frozen-lockfile
pnpm build
pnpm canary run --port 4318 --no-open
```

Source development uses Node.js 24 and pnpm 10.15.0. Add the target project's `.canary/` directory to `.gitignore` before sharing changes.
