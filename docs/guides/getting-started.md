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
```

See [automatic checks](automatic-checks.md), [support scope](support-matrix.md) and [troubleshooting](troubleshooting.md).

Install the project verification Skill with `canary skill install`, and inspect it with `canary skill status --json`. See the [Skill guide](skills.md), [CLI verification](cli.md) and [MCP host integration](mcp.md).

## Releases and upgrades

The installer selects the latest available stable version tag. Set `CANARY_CHANNEL=main` for development builds, or `CANARY_REF` for an explicit tag/commit. The installation record includes the actual CLI version, commit, channel and runtime hash.

```bash
canary upgrade
canary upgrade --rollback
```

Each installation is built in an independent version directory. Launchers and registration change only after runtime validation; a failed upgrade retains the active version. Rollback validates and restores the previous version. Existing source checkouts, project files and evidence are preserved.

中文：默认安装稳定版；设置 `CANARY_CHANNEL=main` 使用开发版，或通过 `CANARY_REF` 固定版本。升级先构建并验证独立副本，失败时保留原安装；`canary upgrade --rollback` 可恢复已验证的上一版本。通过 `canary installation --json` 查看实际版本与提交。

## Build from source

```bash
git clone https://github.com/EVEDensity/Canary.git
cd Canary
pnpm install --frozen-lockfile
pnpm build
pnpm canary run --port 4318 --no-open
```

Source development uses Node.js 24 and pnpm 10.15.0. Add the target project's `.canary/` directory to `.gitignore` before sharing changes.
