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
