<##>
.SYNOPSIS
  Canary global installer for Windows (PowerShell).
#>
param(
  [switch]$Update,
  [switch]$Help
)
$ErrorActionPreference = 'Stop'
$RepoUrl = if ($env:CANARY_REPO_URL) { $env:CANARY_REPO_URL } else { 'https://github.com/EVEDensity/Canary.git' }
$RepoDir = if ($env:CANARY_DIR) { $env:CANARY_DIR } else { Join-Path $HOME 'Canary' }
$CanaryRef = $env:CANARY_REF

function Show-Usage {
  @"
Canary installer (Windows, source checkout)

Usage:
  install.ps1          Clone or update, then install the global canary command
  install.ps1 -Update  Pull the pinned/default ref and reinstall
  install.ps1 -Help    Show this help

Environment:
  CANARY_REPO_URL  Override clone URL
  CANARY_DIR       Override clone destination (default: %USERPROFILE%\Canary)
  CANARY_REF       Optional tag, branch, or commit to pin after cloning/updating

The installer refuses to overwrite a non-Git di