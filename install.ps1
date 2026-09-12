<#
.SYNOPSIS
  Canary global installer for Windows (PowerShell).

.DESCRIPTION
  Clones or updates the Canary repo and runs scripts/install-global.mjs.

.EXAMPLE
  ./install.ps1
  iwr -useb https://raw.githubusercontent.com/EVEDensity/Canary/main/install.ps1 | iex

.EXAMPLE
  ./install.ps1 -Update
#>

param(
  [switch]$Update,
  [switch]$Help
)

$ErrorActionPreference = 'Stop'

$RepoUrl = if ($env:CANARY_REPO_URL) { $env:CANARY_REPO_URL } else { 'https://github.com/EVEDensity/Canary.git' }
$RepoDir = if ($env:CANARY_DIR) { $env:CANARY_DIR } else { Join-Path $HOME 'Canary' }

function Show-Usage {
  @"
Canary installer (Windows)

Usage:
  install.ps1          Clone or update, then install the global canary command
  install.ps1 -Update Pull latest changes and reinstall
  install.ps1 -Help   Show this help

One-line install:
  iwr -useb https://raw.githubusercontent.com/EVEDensity/Canary/main/install.ps1 | iex

Environment:
  CANARY_REPO_URL Override clone URL
  CANARY_DIR      Override clone destination (default: %USERPROFILE%\Canary)
"@
}

function Clone-Or-Update {
  if (Test-Path (Join-Path $RepoDir '.git')) {
    Write-Host "-> Updating existing checkout at $RepoDir"
    git -C $RepoDir pull --ff-only
  } else {
    Write-Host "-> Cloning $RepoUrl -> $RepoDir"
    $parent = Split-Path -Parent $RepoDir
    if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
    git clone $RepoUrl $RepoDir
  }
}

function Install-Canary {
  $installer = Join-Path $RepoDir 'scripts\install-global.mjs'
  if (-not (Test-Path $installer)) {
    throw "Missing installer script at $installer"
  }
  node $installer
}

if ($Help) { Show-Usage; return }

Clone-Or-Update
Install-Canary
