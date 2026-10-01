# Installation and setup

Prepare Node.js 24, Git, and your project's dependencies.

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
```

See [automatic checks](automatic-checks.md), [support scope](support-matrix.md) and [troubleshooting](troubleshooting.md).

## Build from source

```bash
git clone https://github.com/EVEDensity/Canary.git
cd Canary
pnpm install --frozen-lockfile
pnpm build
pnpm canary run --port 4318 --no-open
```

Source development uses Node.js 24 and pnpm 10.15.0. Add the target project's `.canary/` directory to `.gitignore` before sharing changes.
