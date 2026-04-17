$ErrorActionPreference = 'Stop'

$workspace = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $workspace '.runtime'
$schtasksExe = Join-Path $env:SystemRoot 'System32\schtasks.exe'
$watchdogTaskName = 'MobileCodexHelper-Watchdog'
$startupFolder = [Environment]::GetFolderPath('Startup')
$startupLauncherPath = Join-Path $startupFolder 'MobileCodexHelper-Startup.cmd'
$watchdogLauncherPath = Join-Path $runtimeDir 'cache\MobileCodexHelper-Watchdog.cmd'
$pathsToRemove = @(
  (Join-Path $runtimeDir 'auto-start.json'),
  (Join-Path $runtimeDir 'auto-start-state.json'),
  (Join-Path $runtimeDir 'cache\ensure-stack.lock'),
  $startupLauncherPath,
  $watchdogLauncherPath
)

if (-not (Test-Path $schtasksExe)) {
  throw "schtasks.exe not found: $schtasksExe"
}

foreach ($taskName in @($watchdogTaskName)) {
  try {
    & $schtasksExe /Delete /TN $taskName /F 2>$null | Out-Null
  } catch {
  }
}

foreach ($path in $pathsToRemove) {
  Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
}

Write-Host "Removed startup entry and scheduled task:"
Write-Host "  - Startup folder: $startupLauncherPath"
Write-Host "  - Scheduled task: $watchdogTaskName"
Write-Host ""
Write-Host "Removed runtime files:"
foreach ($path in $pathsToRemove) {
  Write-Host "  - $path"
}
