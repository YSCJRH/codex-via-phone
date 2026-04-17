[CmdletBinding()]
param(
  [string]$OutputDir = '',
  [switch]$DryRun,
  [switch]$EmitJson
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\mobile-codex-common.ps1')

$workspace = Get-MobileCodexWorkspace
$runtimeDir = Get-MobileCodexRuntimeDir
$targetDir = if ($OutputDir) {
  $OutputDir
} else {
  Join-Path $runtimeDir ('support\bundle-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
}

$payload = [ordered]@{
  script = 'export-mobile-codex-support-bundle.ps1'
  dryRun = [bool]$DryRun
  redacted = $true
  outputDir = $targetDir
  files = @(
    'status.json',
    'doctor.json',
    'mode-config.json',
    'app-binding.json',
    'auto-start.json',
    'auto-start-state.json',
    'metadata.json'
  )
}

if ($DryRun) {
  if ($EmitJson) {
    $payload | ConvertTo-Json -Depth 6
  } else {
    Write-Output "Dry run: would export a redacted support bundle to $targetDir"
  }
  exit 0
}

New-Item -ItemType Directory -Force -Path $targetDir | Out-Null

$statusJson = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'status-mobile-codex.ps1') -EmitJson 2>&1 | Out-String
$doctorJson = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'doctor-mobile-codex.ps1') -EmitJson 2>&1 | Out-String

Set-Content -Path (Join-Path $targetDir 'status.json') -Value $statusJson.Trim() -Encoding UTF8
Set-Content -Path (Join-Path $targetDir 'doctor.json') -Value $doctorJson.Trim() -Encoding UTF8

$modeConfigPath = Get-MobileCodexModeConfigPath
$bindingPath = Get-MobileCodexBindingPath
$modeConfig = Read-MobileCodexJsonObject -Path $modeConfigPath
if ($modeConfig) {
  ([ordered]@{
      requestedMode = [string]$modeConfig.requestedMode
      effectiveMode = [string]$modeConfig.effectiveMode
      persistentRemotePublish = [bool]$modeConfig.persistentRemotePublish
      legacyStateDetected = [bool]$modeConfig.legacyStateDetected
    } | ConvertTo-Json -Depth 4) | Set-Content -Path (Join-Path $targetDir 'mode-config.json') -Encoding UTF8
}

$binding = Read-MobileCodexJsonObject -Path $bindingPath
if ($binding) {
  ([ordered]@{
      mode = [string]$binding.mode
      remoteVisibility = [string]$binding.remoteVisibility
      hasUrl = [bool]$binding.url
      hasPreferredUrl = [bool]$binding.preferredUrl
      hasServeUrl = [bool]$binding.serveUrl
      hasFunnelUrl = [bool]$binding.funnelUrl
      requiresTailscaleClient = [bool]$binding.requiresTailscaleClient
    } | ConvertTo-Json -Depth 4) | Set-Content -Path (Join-Path $targetDir 'app-binding.json') -Encoding UTF8
}

$autoStartConfig = Read-MobileCodexJsonObject -Path (Join-Path $runtimeDir 'auto-start.json')
if ($autoStartConfig) {
  ([ordered]@{
      enabled = [bool]$autoStartConfig.enabled
      startupDelaySeconds = [int]$autoStartConfig.startupDelaySeconds
      watchdogIntervalMinutes = [int]$autoStartConfig.watchdogIntervalMinutes
      ensureRemotePublish = [bool]$autoStartConfig.ensureRemotePublish
      restartCooldownSeconds = [int]$autoStartConfig.restartCooldownSeconds
      preserveKnownPublicBinding = [bool]$autoStartConfig.preserveKnownPublicBinding
    } | ConvertTo-Json -Depth 4) | Set-Content -Path (Join-Path $targetDir 'auto-start.json') -Encoding UTF8
}

$autoStartState = Read-MobileCodexJsonObject -Path (Join-Path $runtimeDir 'auto-start-state.json')
if ($autoStartState) {
  ([ordered]@{
      lastRunAt = $autoStartState.lastRunAt
      lastResult = [string]$autoStartState.lastResult
      lastAction = [string]$autoStartState.lastAction
      appHealthy = $autoStartState.appHealthy
      remoteIntent = [bool]$autoStartState.remoteIntent
      trigger = $autoStartState.trigger
      hasLastError = [bool]([string]$autoStartState.lastError)
    } | ConvertTo-Json -Depth 4) | Set-Content -Path (Join-Path $targetDir 'auto-start-state.json') -Encoding UTF8
}

([ordered]@{
    exportedAt = (Get-Date).ToString('o')
    redacted = $true
    source = 'codex-via-phone support bundle'
  } | ConvertTo-Json -Depth 4) | Set-Content -Path (Join-Path $targetDir 'metadata.json') -Encoding UTF8

if ($EmitJson) {
  $payload | ConvertTo-Json -Depth 6
} else {
  Write-Output "Redacted support bundle exported to $targetDir"
}
exit 0
