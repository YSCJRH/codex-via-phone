[CmdletBinding()]
param(
  [switch]$DryRun,
  [switch]$EmitJson
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\mobile-codex-common.ps1')

$workspace = Get-MobileCodexWorkspace
$pythonCommand = Resolve-MobileCodexPythonCommand

function Get-FallbackStatus {
  $modeConfig = Get-MobileCodexModeConfig
  $binding = Read-MobileCodexJsonObject -Path (Get-MobileCodexBindingPath)

  return [ordered]@{
    script = 'status-mobile-codex.ps1'
    dryRun = [bool]$DryRun
    readOnly = $true
    redacted = $true
    checkedAt = (Get-Date).ToString('o')
    summary = [ordered]@{
      mode_requested = [string]$modeConfig.requestedMode
      mode_effective = [string]$modeConfig.effectiveMode
      mode_persistent_remote_publish = [bool]$modeConfig.persistentRemotePublish
      legacy_state_detected = [bool]$modeConfig.legacyStateDetected
      binding_mode = if ($binding) { [string]$binding.mode } else { $null }
      binding_visibility = if ($binding) { [string]$binding.remoteVisibility } else { $null }
    }
  }
}

if ($DryRun) {
  $payload = [ordered]@{
    script = 'status-mobile-codex.ps1'
    dryRun = $true
    readOnly = $true
    redacted = $true
    checks = @('mode-config', 'app-binding', 'desktop status json')
  }
  if ($EmitJson) {
    $payload | ConvertTo-Json -Depth 6
  } else {
    Write-Output 'Dry run: status-mobile-codex.ps1 would read mode-config, app-binding, and the redacted desktop status JSON.'
  }
  exit 0
}

if ($pythonCommand) {
  $previousDontWriteBytecode = $env:PYTHONDONTWRITEBYTECODE
  $env:PYTHONDONTWRITEBYTECODE = '1'
  try {
    $statusOutput = & $pythonCommand.Path (Join-Path $workspace 'mobile_codex_control.py') --json 2>&1 | Out-String
    if ($LASTEXITCODE -eq 0) {
      if ($EmitJson) {
        $statusOutput.Trim()
      } else {
        $status = $statusOutput | ConvertFrom-Json
        Write-Output "Mode: $($status.summary.mode_name)"
        Write-Output "Local URL: $($status.local_url)"
        Write-Output "Mode URL: $($status.mode_url)"
        Write-Output "Approved devices: $($status.summary.approved_devices)"
        Write-Output "Pending approvals: $($status.summary.pending_approvals)"
      }
      exit 0
    }
  } finally {
    if ($null -eq $previousDontWriteBytecode) {
      Remove-Item Env:\PYTHONDONTWRITEBYTECODE -ErrorAction SilentlyContinue
    } else {
      $env:PYTHONDONTWRITEBYTECODE = $previousDontWriteBytecode
    }
  }
}

$fallback = Get-FallbackStatus
if ($EmitJson) {
  $fallback | ConvertTo-Json -Depth 6
} else {
  Write-Output "Mode requested: $($fallback.summary.mode_requested)"
  Write-Output "Mode effective: $($fallback.summary.mode_effective)"
}
exit 0
