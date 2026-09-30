<#
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

The installer refuses to overwrite a non-Git directory or update a dirty checkout.
Offline failures leave the existing installation untouched and print the Git/pnpm error.
"@
}
function Invoke-Checked([string]$Command, [string[]]$Arguments) {
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE" }
}
function Assert-Tool([string]$Command) {
  if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) { throw "$Command is required but was not found on PATH." }
}
function Clone-Or-Update {
  Assert-Tool 'git'
  if (Test-Path (Join-Path $RepoDir '.git')) {
    $status = (& git -C $RepoDir status --porcelain)
    if ($status) { throw "Refusing to update dirty checkout: $RepoDir" }
    Write-Host "-> Updating existing checkout at $RepoDir"
    Invoke-Checked 'git' @('-C', $RepoDir, 'pull', '--ff-only')
  } elseif (Test-Path $RepoDir) {
    $entries = Get-ChildItem -Force $RepoDir
    if ($entries.Count -gt 0) { throw "Refusing to overwrite non-Git directory: $RepoDir" }
    Write-Host "-> Cloning $RepoUrl -> $RepoDir"
    Invoke-Checked 'git' @('clone', $RepoUrl, $RepoDir)
  } else {
    Write-Host "-> Cloning $RepoUrl -> $RepoDir"
    New-Item -ItemType Directory -Path (Split-Path -Parent $RepoDir) -Force | Out-Null
    Invoke-Checked 'git' @('clone', $RepoUrl, $RepoDir)
  }
  if ($CanaryRef) {
    Invoke-Checked 'git' @('-C', $RepoDir, 'fetch', '--tags', '--prune', 'origin')
    Invoke-Checked 'git' @('-C', $RepoDir, 'checkout', '--detach', $CanaryRef)
  }
}
function Install-Canary {
  $installer = Join-Path $RepoDir 'scripts\install-global.mjs'
  if (-not (Test-Path $installer)) { throw "Missing installer script at $installer" }
  Assert-Tool 'node'
  Invoke-Checked 'node' @($installer)
}
if ($Help) { Show-Usage; exit 0 }
Clone-Or-Update
Install-Canary
