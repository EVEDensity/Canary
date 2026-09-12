# Getting Started

## One-line global install (recommended)

After this, open a **new terminal** and run `canary run` from **any directory**.

### Windows (PowerShell)

```powershell
iwr -useb https://raw.githubusercontent.com/EVEDensity/Canary/main/install.ps1 | iex
```

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/EVEDensity/Canary/main/install.sh | bash
```

The scripts clone to `~/Canary` (or `%USERPROFILE%\Canary` on Windows), then run `scripts/install-global.mjs`. Override with `CANARY_DIR` / `CANARY_REPO_URL` if needed.

### Manual clone (alternative)

```powershell
git clone https://github.com/EVEDensity/Canary.git "$env:USERPROFILE\Canary"; node "$env:USERPROFILE\Canary\scripts\install-global.mjs"
```

The installer will:

1. Install workspace dependencies and build packages
2. Register the project at `~/.canary/home.json`
3. Add a global `canary` command to your user `PATH`

Then:

```powershell
canary run
```

This runs the default 15-case demo, opens the local UI, and writes artifacts under `%USERPROFILE%\Canary\.canary\artifacts\` (or `$HOME/Canary/.canary/artifacts/`).

Headless:

```powershell
canary run --headless --no-open
```

## Already cloned the repo?

From the repository root:

```powershell
node scripts/install-global.mjs
# or
pnpm install:global
```

## Repo-only workflow (no global command)

If you prefer not to install globally:

```powershell
pnpm install
pnpm demo
```

## Requirements

- Node.js **22+**
- Git
- pnpm **10** (the installer enables Corepack automatically if pnpm is missing)

## Next steps

- [Agent Adapter](./agent-adapter.md)
- [Feature Coverage](./feature-coverage.md)
- [Local UI](./local-ui.md)
- [10-minute acceptance](./acceptance-10-min.md)
