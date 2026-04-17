$workspace = Split-Path -Parent $PSScriptRoot
$reportRoot = Join-Path $workspace '.runtime\reports'
$timestamp = Get-Date
$stamp = $timestamp.ToString('yyyyMMdd-HHmmss')
$jsonPath = Join-Path $reportRoot "connectivity-audit-$stamp.json"
$mdPath = Join-Path $reportRoot "connectivity-audit-$stamp.md"

New-Item -ItemType Directory -Force -Path $reportRoot | Out-Null

function Read-JsonFile {
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

function Resolve-TailscaleCommand {
  if ($env:MOBILE_CODEX_TAILSCALE -and (Test-Path $env:MOBILE_CODEX_TAILSCALE)) {
    return $env:MOBILE_CODEX_TAILSCALE
  }

  $default = 'C:\Program Files\Tailscale\tailscale.exe'
  if (Test-Path $default) {
    return $default
  }

  return $null
}

function Resolve-PythonCommand {
  $python = Get-Command python -ErrorAction SilentlyContinue
  if ($python) {
    return $python.Path
  }

  return $null
}

function Invoke-CapturedBlock {
  param(
    [Parameter(Mandatory = $true)]
    [scriptblock]$ScriptBlock
  )

  try {
    $output = & $ScriptBlock 2>&1 | Out-String
    $status = $LASTEXITCODE
    if ($null -eq $status) {
      $status = 0
    }
    return @{
      ok = ($status -eq 0)
      exitCode = $status
      output = $output.Trim()
    }
  } catch {
    return @{
      ok = $false
      exitCode = -1
      output = ($_ | Out-String).Trim()
    }
  }
}

function Invoke-HttpProbe {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Url,
    [int]$TimeoutSec = 5
  )

  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec $TimeoutSec
    return @{
      ok = $true
      statusCode = [int]$response.StatusCode
      body = [string]$response.Content
      error = $null
    }
  } catch {
    $httpResponse = $_.Exception.Response
    $statusCode = $null
    $body = $null
    if ($httpResponse) {
      try {
        $statusCode = [int]$httpResponse.StatusCode
      } catch {
      }
    }

    return @{
      ok = $false
      statusCode = $statusCode
      body = $body
      error = $_.Exception.Message
    }
  }
}

function Invoke-CurlHead {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Url
  )

  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if (-not $curl) {
    return @{
      ok = $false
      exitCode = -1
      output = 'curl.exe not found'
    }
  }

  return Invoke-CapturedBlock { & $curl.Path -I $Url }
}

function Get-ServeHosts {
  param(
    [string]$ServeStatusText
  )

  $httpsHosts = @()
  $httpHosts = @()

  if ($ServeStatusText) {
    $httpsHosts = [regex]::Matches($ServeStatusText, '(?m)^https://([^\s]+)') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique
    $httpHosts = [regex]::Matches($ServeStatusText, '(?m)^http://([^\s]+)') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique
  }

  return @{
    https = @($httpsHosts)
    http = @($httpHosts)
  }
}

$bindingPath = Join-Path $workspace '.runtime\app-binding.json'
$bridgePath = Join-Path $workspace '.runtime\desktop-approval-bridge-window.json'
$diagnosticsRoot = Join-Path $workspace '.runtime\diagnostics'
$connectivityEventsPath = Join-Path $diagnosticsRoot 'connectivity-events.json'
$syncEventsPath = Join-Path $diagnosticsRoot 'sync-events.json'
$syncSnapshotsPath = Join-Path $diagnosticsRoot 'sync-snapshots.json'
$binding = Read-JsonFile -Path $bindingPath
$bridge = Read-JsonFile -Path $bridgePath
$connectivityEvents = Read-JsonFile -Path $connectivityEventsPath
$syncEvents = Read-JsonFile -Path $syncEventsPath
$syncSnapshots = Read-JsonFile -Path $syncSnapshotsPath
$recentConnectivityEvents = @($connectivityEvents | Select-Object -Last 50)
$recentSyncEvents = @($syncEvents | Select-Object -Last 50)
$recentSyncSnapshots = @($syncSnapshots | Select-Object -Last 20)
$tailscaleCmd = Resolve-TailscaleCommand
$pythonCmd = Resolve-PythonCommand

$localUrl = 'http://127.0.0.1:3001'
$localHealth = Invoke-HttpProbe -Url "$localUrl/health"

$directUrl = $null
if ($binding -and $binding.url) {
  $directUrl = [string]$binding.url
}

$directHealth = $null
$directServeHttpHealth = $null
if ($binding -and $binding.host) {
  $directHealth = Invoke-HttpProbe -Url ("http://{0}:{1}/health" -f $binding.host, $binding.port)
  $directServeHttpHealth = Invoke-HttpProbe -Url ("http://{0}:8081/" -f $binding.host)
}

$runtimeCheck = Invoke-CapturedBlock {
  powershell -ExecutionPolicy Bypass -File (Join-Path $workspace 'scripts\check-mobile-codex-runtime.ps1')
}

$tailscaleCheck = Invoke-CapturedBlock {
  powershell -ExecutionPolicy Bypass -File (Join-Path $workspace 'scripts\check-tailscale-status.ps1')
}

$controlJsonRaw = Invoke-CapturedBlock {
  if (-not $pythonCmd) {
    throw 'python not found'
  }

  & $pythonCmd (Join-Path $workspace 'mobile_codex_control.py') --json
}

$controlJson = $null
if ($controlJsonRaw.ok -and $controlJsonRaw.output) {
  try {
    $controlJson = $controlJsonRaw.output | ConvertFrom-Json -Depth 10
  } catch {
    $controlJson = $null
  }
}

$serveStatus = if ($tailscaleCmd) {
  Invoke-CapturedBlock { & $tailscaleCmd serve status }
} else {
  @{
    ok = $false
    exitCode = -1
    output = 'tailscale command not found'
  }
}

$serveHosts = Get-ServeHosts -ServeStatusText $serveStatus.output
$httpsServeProbe = $null
if ($serveHosts.https.Count -gt 0) {
  $httpsServeProbe = Invoke-CurlHead -Url ("https://{0}/health" -f $serveHosts.https[0])
}

$netstatRelevant = Invoke-CapturedBlock {
  netstat -ano
}

$relevantListeners = @()
if ($netstatRelevant.output) {
  $relevantListeners = $netstatRelevant.output -split "`r?`n" | Where-Object {
    ($_.Contains('LISTENING')) -and (
      ($_ -match ':3001\s') -or
      ($_ -match ':443\s') -or
      ($_ -match ':8081\s')
    )
  }
}

$report = [ordered]@{
  generatedAt = $timestamp.ToString('o')
  workspace = $workspace
  binding = $binding
  desktopApprovalBridge = $bridge
  localHealth = $localHealth
  directUrl = $directUrl
  directHealth = $directHealth
  directServeHttpProbe = $directServeHttpHealth
  runtimeCheck = $runtimeCheck
  tailscaleCheck = $tailscaleCheck
  serveStatus = $serveStatus
  serveHosts = $serveHosts
  httpsServeProbe = $httpsServeProbe
  controlPanelRaw = $controlJsonRaw
  controlPanel = $controlJson
  diagnostics = [ordered]@{
    connectivityEvents = $recentConnectivityEvents
    syncEvents = $recentSyncEvents
    syncSnapshots = $recentSyncSnapshots
    wsRecentDisconnects = if ($controlJson) { $controlJson.summary.ws_recent_disconnects } else { $null }
    lastSuccessfulMobileSync = if ($controlJson) { $controlJson.summary.last_successful_mobile_sync } else { $null }
    lastSyncDivergence = if ($controlJson) { $controlJson.summary.last_sync_divergence } else { $null }
  }
  listeners = $relevantListeners
}

$report | ConvertTo-Json -Depth 10 | Set-Content -Path $jsonPath -Encoding UTF8

$summaryLines = @(
  "# Mobile Codex Connectivity Audit",
  "",
  "- Generated at: $($report.generatedAt)",
  "- Workspace: $workspace",
  "- Binding mode: $($binding.mode)",
  "- Binding URL: $($binding.url)",
  "- Local health: $(if ($localHealth.ok) { 'OK' } else { 'FAIL' })",
  "- Direct health: $(if ($directHealth.ok) { 'OK' } else { 'FAIL' })",
  "- Serve status readable: $(if ($serveStatus.ok) { 'yes' } else { 'no' })",
  "- Desktop approval bridge active: $(if ($controlJson -and $controlJson.summary.desktop_bridge_active) { 'yes' } else { 'no' })",
  "- Approved devices: $(if ($controlJson) { $controlJson.summary.approved_devices } else { 'unknown' })",
  "- WS recent disconnects: $(if ($controlJson) { $controlJson.summary.ws_recent_disconnects } else { 'unknown' })",
  "- Last successful mobile sync: $(if ($controlJson -and $controlJson.summary.last_successful_mobile_sync) { ($controlJson.summary.last_successful_mobile_sync | ConvertTo-Json -Compress) } else { 'none' })",
  "- Last sync divergence: $(if ($controlJson -and $controlJson.summary.last_sync_divergence) { ($controlJson.summary.last_sync_divergence | ConvertTo-Json -Compress) } else { 'none' })",
  "",
  "## Observed Paths",
  "",
  "- Direct: $directUrl",
  "- Serve HTTPS: $(if ($serveHosts.https.Count -gt 0) { 'https://' + $serveHosts.https[0] } else { 'not detected' })",
  "- Serve HTTP fallback: $(if ($serveHosts.http.Count -gt 0) { 'http://' + $serveHosts.http[-1] } else { 'not detected' })",
  "",
  "## Key Probes",
  "",
  "- Local /health: $(($localHealth | ConvertTo-Json -Compress))",
  "- Direct /health: $(($directHealth | ConvertTo-Json -Compress))",
  "- Serve HTTP /: $(($directServeHttpHealth | ConvertTo-Json -Compress))",
  "- Serve HTTPS /health (curl head): $(($httpsServeProbe | ConvertTo-Json -Compress))",
  "",
  "## Relevant Listeners",
  ""
)

if ($relevantListeners.Count -gt 0) {
  $summaryLines += $relevantListeners | ForEach-Object { "- $_" }
} else {
  $summaryLines += "- none captured"
}

$summaryLines += @(
  "",
  "## Raw Sources",
  "",
  "- Recent connectivity timeline events:",
  $(if ($recentConnectivityEvents.Count -gt 0) { ($recentConnectivityEvents | ConvertTo-Json -Depth 8 -Compress) } else { '[]' }),
  "",
  "- Recent sync timeline events:",
  $(if ($recentSyncEvents.Count -gt 0) { ($recentSyncEvents | ConvertTo-Json -Depth 8 -Compress) } else { '[]' }),
  "",
  "- Recent sync snapshots:",
  $(if ($recentSyncSnapshots.Count -gt 0) { ($recentSyncSnapshots | ConvertTo-Json -Depth 8 -Compress) } else { '[]' }),
  "",
  "- Runtime check:",
  $runtimeCheck.output,
  "",
  "- Tailscale check:",
  $tailscaleCheck.output,
  "",
  "- Tailscale serve status:",
  $serveStatus.output,
  ""
)

$summaryLines -join "`r`n" | Set-Content -Path $mdPath -Encoding UTF8

Write-Output "JSON report: $jsonPath"
Write-Output "Markdown report: $mdPath"
