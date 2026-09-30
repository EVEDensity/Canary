<#
.SYNOPSIS
  Remove the Canary global command without deleting project data.
#>
param(
  [switch]$RemoveRoot,
  [switch]$Help
)
$ErrorActionPreference = 'Stop'
if ($Help) {
  @"
Canary uninstaller (Windows)

Usage:
  .\uninstall.ps1                 Remove launcher and registration; preserve project/evidence
  .\uninstall.ps1 -RemoveRoot    Also remove the registered installation checkout
  .\uninstall.ps1 -Help           Show this help
"@
  exit 0
}
$script = Join-Path $PSScriptRoot '..\uninstall-global.mjs'
if (-not (Test-Path $script)) { throw "Missing uninstaller script at $script" }
$args = @()
if ($RemoveRoot) { $args += '--remove-root' }
node $script @args
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
