[CmdletBinding()]
param(
  [switch]$DryRun,
  [switch]$EmitJson
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\mobile-codex-common.ps1')

$runtimeSummary = Get-MobileCodexRuntimeSummary
$modeConfig = Get-MobileCodexModeConfig
$binding = Read-MobileCodexJsonObject -Path (Get-MobileCodexBindingPath)

function Test-HealthyEndpoint {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Uri
  )

  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 5
    return ($response.StatusCode -eq 200)
  } catch {
    return $false
  }
}

function Get-PathLabel {
  param(
    [string]$Path,
    [string]$Label
  )

  if (-not $Path) {
    return $null
  }

  return $Label
}

$checks = [ordered]@{
  upstream = [ordered]@{
    ok = [bool]$runtimeSummary.UpstreamExists
    detail = if ($runtimeSummary.UpstreamExists) { '<UPSTREAM_DIR>' } else { 'missing' }
  }
  node = [ordered]@{
    ok = [bool]$runtimeSummary.Node
    detail = if ($runtimeSummary.Node) { '<NODE>' } else { 'missing' }
  }
  npm = [ordered]@{
    ok = [bool]$runtimeSummary.Npm
    detail = if ($runtimeSummary.Npm) { '<NPM>' } else { 'missing' }
  }
  nginx = [ordered]@{
    ok = [bool]$runtimeSummary.Nginx
    detail = if ($runtimeSummary.Nginx) { '<NGINX>' } else { 'missing' }
  }
  python = [ordered]@{
    ok = [bool]$runtimeSummary.Python
    detail = if ($runtimeSummary.Python) { '<PYTHON>' } else { 'missing' }
  }
  tailscale = [ordered]@{
    ok = if ([string]$modeConfig.requestedMode -eq 'localhost') { $true } else { [bool]$runtimeSummary.Tailscale }
    detail = if ($runtimeSummary.Tailscale) { '<TAILSCALE>' } elseif ([string]$modeConfig.requestedMode -eq 'localhost') { 'not required for localhost' } else { 'missing' }
  }
  appHealth = [ordered]@{
    ok = if ($DryRun) { $null } else { (Test-HealthyEndpoint -Uri 'http://127.0.0.1:3001/health') }
    detail = if ($DryRun) { 'dry-run skipped live probe' } else { 'GET /health on 127.0.0.1:3001' }
  }
  nginxHealth = [ordered]@{
    ok = if ($DryRun) { $null } else { (Test-HealthyEndpoint -Uri 'http://127.0.0.1:8080/health') }
    detail = if ($DryRun) { 'dry-run skipped live probe' } else { 'GET /health on 127.0.0.1:8080' }
  }
  modeConsistency = [ordered]@{
    ok = if ($binding) { ([string]$binding.mode -eq [string]$modeConfig.effectiveMode) } else { $true }
    detail = if ($binding) { "binding=$([string]$binding.mode) mode-config=$([string]$modeConfig.effectiveMode)" } else { 'app-binding.json not present yet' }
  }
}

$precheckFailed = @($checks.upstream.ok, $checks.node.ok, $checks.npm.ok, $checks.nginx.ok, $checks.python.ok, $checks.tailscale.ok) -contains $false
$verificationFailed = ($checks.modeConsistency.ok -eq $false)

$payload = [ordered]@{
  script = 'doctor-mobile-codex.ps1'
  dryRun = [bool]$DryRun
  readOnly = $true
  redacted = $true
  checkedAt = (Get-Date).ToString('o')
  modeConfig = [ordered]@{
    requestedMode = [string]$modeConfig.requestedMode
    effectiveMode = [string]$modeConfig.effectiveMode
    persistentRemotePublish = [bool]$modeConfig.persistentRemotePublish
    legacyStateDetected = [bool]$modeConfig.legacyStateDetected
    allowedOriginCount = @($modeConfig.allowedOrigins).Count
  }
  binding = [ordered]@{
    mode = if ($binding) { [string]$binding.mode } else { $null }
    remoteVisibility = if ($binding) { [string]$binding.remoteVisibility } else { $null }
    hasServeUrl = if ($binding) { [bool]$binding.serveUrl } else { $false }
    hasFunnelUrl = if ($binding) { [bool]$binding.funnelUrl } else { $false }
  }
  checks = $checks
}

if ($EmitJson) {
  $payload | ConvertTo-Json -Depth 8
} else {
  Write-Output "Mode requested: $($payload.modeConfig.requestedMode)"
  Write-Output "Mode effective: $($payload.modeConfig.effectiveMode)"
  Write-Output "Legacy state detected: $($payload.modeConfig.legacyStateDetected)"
  Write-Output "Upstream: $($checks.upstream.detail)"
  Write-Output "Node: $($checks.node.detail)"
  Write-Output "nginx: $($checks.nginx.detail)"
}

if ($DryRun) {
  exit 0
}

if ($precheckFailed) {
  exit 2
}

if ($verificationFailed) {
  exit 4
}

exit 0
