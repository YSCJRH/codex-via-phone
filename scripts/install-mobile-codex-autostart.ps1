$ErrorActionPreference = 'Stop'

$workspace = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $workspace '.runtime'
$cacheDir = Join-Path $runtimeDir 'cache'
$configPath = Join-Path $runtimeDir 'auto-start.json'
$statePath = Join-Path $runtimeDir 'auto-start-state.json'
$ensureScript = Join-Path $PSScriptRoot 'ensure-mobile-codex-stack.ps1'
$runtimeCheckScript = Join-Path $PSScriptRoot 'check-mobile-codex-runtime.ps1'
$schtasksExe = Join-Path $env:SystemRoot 'System32\schtasks.exe'
$powershellExe = Join-Path $PSHOME 'powershell.exe'
$watchdogTaskName = 'MobileCodexHelper-Watchdog'
$startupFolder = [Environment]::GetFolderPath('Startup')
$startupLauncherPath = Join-Path $startupFolder 'MobileCodexHelper-Startup.cmd'
$watchdogLauncherPath = Join-Path $cacheDir 'MobileCodexHelper-Watchdog.cmd'

function Get-DefaultAutoStartConfig {
  return [ordered]@{
    enabled = $true
    startupDelaySeconds = 45
    watchdogIntervalMinutes = 5
    ensureRemotePublish = $true
    restartCooldownSeconds = 120
    preserveKnownPublicBinding = $true
  }
}

function Read-JsonObject {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (-not (Test-Path $Path)) {
    return $null
  }

  try {
    return Get-Content -Raw -Path $Path | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Write-JsonObject {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [hashtable]$Data
  )

  $parent = Split-Path -Parent $Path
  if ($parent) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }
  $Data | ConvertTo-Json -Depth 6 | Set-Content -Path $Path -Encoding UTF8
}

function Merge-AutoStartConfig {
  $defaults = Get-DefaultAutoStartConfig
  $existing = Read-JsonObject -Path $configPath
  $merged = [ordered]@{}

  foreach ($key in $defaults.Keys) {
    if ($existing -and $existing.PSObject.Properties.Name -contains $key -and $null -ne $existing.$key) {
      $merged[$key] = $existing.$key
    } else {
      $merged[$key] = $defaults[$key]
    }
  }

  $merged.enabled = [bool]$merged.enabled
  $merged.startupDelaySeconds = [int]$merged.startupDelaySeconds
  $merged.watchdogIntervalMinutes = [int]$merged.watchdogIntervalMinutes
  $merged.ensureRemotePublish = [bool]$merged.ensureRemotePublish
  $merged.restartCooldownSeconds = [int]$merged.restartCooldownSeconds
  $merged.preserveKnownPublicBinding = [bool]$merged.preserveKnownPublicBinding
  return $merged
}

function New-StartupLauncher {
  param(
    [Parameter(Mandatory = $true)]
    [hashtable]$Config
  )

  New-Item -ItemType Directory -Force -Path $startupFolder | Out-Null
  $command = "@echo off`r`n""{0}"" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command ""Start-Sleep -Seconds {1}; & '{2}' -Trigger startup""" -f $powershellExe, [int]$Config.startupDelaySeconds, $ensureScript
  Set-Content -Path $startupLauncherPath -Value $command -Encoding ASCII
}

function New-WatchdogLauncher {
  $command = "@echo off`r`n""{0}"" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{1}"" -Trigger watchdog" -f $powershellExe, $ensureScript
  Set-Content -Path $watchdogLauncherPath -Value $command -Encoding ASCII
}

function Register-WatchdogTask {
  param(
    [Parameter(Mandatory = $true)]
    [hashtable]$Config
  )

  $taskCommand = 'cmd.exe /c """{0}"""' -f $watchdogLauncherPath
  & $schtasksExe /Delete /TN $watchdogTaskName /F 2>$null | Out-Null
  $createOutput = & $schtasksExe /Create /F /TN $watchdogTaskName /TR $taskCommand /SC MINUTE /MO ([string][int]$Config.watchdogIntervalMinutes) 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) {
    $message = $createOutput.Trim()
    if (-not $message) {
      $message = "Failed to register scheduled task: $watchdogTaskName"
    }
    throw $message
  }
}

if (-not (Test-Path $ensureScript)) {
  throw "Autostart ensure script not found: $ensureScript"
}
if (-not (Test-Path $runtimeCheckScript)) {
  throw "Runtime check script not found: $runtimeCheckScript"
}
if (-not (Test-Path $schtasksExe)) {
  throw "schtasks.exe not found: $schtasksExe"
}

New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null

$runtimeReport = & $powershellExe -NoProfile -ExecutionPolicy Bypass -File $runtimeCheckScript | Out-String
if ($LASTEXITCODE -ne 0) {
  $runtimeMessage = $runtimeReport.Trim()
  if (-not $runtimeMessage) {
    $runtimeMessage = 'Runtime check failed.'
  }
  throw $runtimeMessage
}

$config = Merge-AutoStartConfig
Write-JsonObject -Path $configPath -Data $config

if (-not (Test-Path $statePath)) {
  Write-JsonObject -Path $statePath -Data ([ordered]@{
      lastRunAt = $null
      lastResult = 'installed'
      lastAction = 'install-autostart'
      lastError = $null
      appHealthy = $null
      remoteIntent = [bool]$config.ensureRemotePublish
      trigger = $null
    })
}

New-StartupLauncher -Config $config
New-WatchdogLauncher
Register-WatchdogTask -Config $config

Write-Host "Installed startup entry and watchdog task:"
Write-Host "  - Startup folder: $startupLauncherPath"
Write-Host "  - Scheduled task: $watchdogTaskName"
Write-Host ""
Write-Host "Autostart config written to: $configPath"
Write-Host "Runtime check summary:"
Write-Host $runtimeReport.Trim()
