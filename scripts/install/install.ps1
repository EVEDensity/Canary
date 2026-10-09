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
if ($RepoUrl -match '^https?://[^/]*@') { throw 'Use external credential injection, not credentials in the clone URL.' }
$RepoDir = if ($env:CANARY_DIR) { $env:CANARY_DIR } else { Join-Path $HOME 'Canary' }

function Show-Usage {
  @"
Canary installer (Windows, source checkout)

Usage:
  install.ps1          Prepare source, then install the global canary command
  install.ps1 -Update  Prepare a fresh source and reinstall the selected release
  install.ps1 -Help    Show this help

Environment:
  CANARY_REPO_URL  Override clone URL
  CANARY_DIR       Override clone destination (default: %USERPROFILE%\Canary)
  CANARY_REF       Optional tag, branch, or commit to pin after cloning/updating
  CANARY_CHANNEL   stable (default) or main development builds

Existing checkouts and the active installation are preserved during preparation.
Stable tags are selected by default; publication happens only after runtime validation.
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
    # Keep legacy active checkouts untouched until the new runtime is validated.
    $installState = if ($env:CANARY_INSTALL_HOME) { $env:CANARY_INSTALL_HOME } else { Join-Path $HOME '.canary' }
    $script:RepoDir = Join-Path (Join-Path $installState 'sources') ([guid]::NewGuid().ToString())
    New-Item -ItemType Directory -Path (Split-Path -Parent $RepoDir) -Force | Out-Null
    Invoke-Checked 'git' @('clone', '--branch', 'main', $RepoUrl, $RepoDir)
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
  # CANARY_REF and CANARY_CHANNEL are resolved by the transactional Node installer.
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
