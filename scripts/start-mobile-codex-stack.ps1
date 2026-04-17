$workspace = Split-Path -Parent $PSScriptRoot
$powershellExe = Join-Path $PSHOME 'powershell.exe'
$cmdExe = Join-Path $env:SystemRoot 'System32\cmd.exe'

function Wait-HealthyEndpoint {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Uri,
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [int]$TimeoutSeconds = 30
  )

  for ($attempt = 0; $attempt -lt $TimeoutSeconds; $attempt++) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 5
      if ($response.StatusCode -eq 200) {
        return
      }
    } catch {
    }

    Start-Sleep -Seconds 1
  }

  throw "$Name did not become healthy at $Uri within $TimeoutSeconds seconds"
}

function Normalize-ProcessPathEnvironment {
  $pathValues = @(
    [Environment]::GetEnvironmentVariable('Path', 'Process'),
    [Environment]::GetEnvironmentVariable('PATH', 'Process')
  ) | Where-Object { $_ }

  if ($pathValues.Count -eq 0) {
    return
  }

  $normalizedPath = (
    $pathValues |
      ForEach-Object { $_ -split ';' } |
      Where-Object { $_ } |
      Select-Object -Unique
  ) -join ';'

  [Environment]::SetEnvironmentVariable('Path', $normalizedPath, 'Process')
  [Environment]::SetEnvironmentVariable('PATH', $null, 'Process')
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

function Resolve-AppBindHost {
  if ($env:MOBILE_CODEX_BIND_HOST) {
    return $env:MOBILE_CODEX_BIND_HOST
  }

  $mode = if ($env:MOBILE_CODEX_BIND_MODE) { $env:MOBILE_CODEX_BIND_MODE } else { 'tailscale-direct' }
  if ($mode -eq 'localhost') {
    return '127.0.0.1'
  }

  return '0.0.0.0'
}

function Resolve-AppPublicHost {
  param(
    [string]$BindHost
  )

  if ($BindHost -and $BindHost -ne '0.0.0.0') {
    return $BindHost
  }

  $tailscale = Resolve-TailscaleCommand
  if (-not $tailscale) {
    return '127.0.0.1'
  }

  try {
    $ipv4 = (& $tailscale ip -4 2>$null | Select-Object -First 1).Trim()
    if ($ipv4) {
      return $ipv4
    }
  } catch {
  }

  return '127.0.0.1'
}

function Resolve-TailscaleHttpsPublication {
  $tailscale = Resolve-TailscaleCommand
  if (-not $tailscale) {
    return $null
  }

  try {
    $statusText = (& $tailscale funnel status 2>$null | Out-String).Trim()
    if (-not $statusText) {
      $statusText = (& $tailscale serve status 2>$null | Out-String).Trim()
    }

    if (-not $statusText) {
      return $null
    }

    $httpsLine = $statusText -split "`r?`n" | Where-Object { $_ -match '^https://[^\s]+' } | Select-Object -First 1
    if (-not $httpsLine) {
      return $null
    }

    $match = [regex]::Match($httpsLine.Trim(), '^(https://[^\s]+)(?:\s+\(([^)]+)\))?')
    if ($match.Success) {
      $label = if ($match.Groups[2].Success) { $match.Groups[2].Value.ToLowerInvariant() } else { '' }
      $tailnetOnly = $label.Contains('tailnet only')
      return [pscustomobject]@{
        url = $match.Groups[1].Value.TrimEnd('/')
        visibility = if ($tailnetOnly) { 'tailnet-only' } else { 'public-funnel' }
        requiresTailscaleClient = $tailnetOnly
      }
    }
  } catch {
  }

  return $null
}

function Load-AppBinding {
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

function Get-PreservedHttpsPublication {
  param(
    [Parameter(Mandatory = $false)]
    [object]$Binding
  )

  if (-not $Binding) {
    return $null
  }

  $existingVisibility = [string]$Binding.remoteVisibility
  if ($existingVisibility -notin @('public-funnel', 'tailnet-only')) {
    return $null
  }

  $existingUrl = @(
    [string]$Binding.funnelUrl,
    [string]$Binding.serveUrl,
    [string]$Binding.url
  ) | Where-Object { $_ -and $_.Trim().StartsWith('https://') } | Select-Object -First 1

  if (-not $existingUrl) {
    return $null
  }

  return [pscustomobject]@{
    url = $existingUrl.TrimEnd('/')
    visibility = $existingVisibility
    requiresTailscaleClient = if ($null -ne $Binding.requiresTailscaleClient) {
      [bool]$Binding.requiresTailscaleClient
    } else {
      $existingVisibility -eq 'tailnet-only'
    }
  }
}

function Resolve-AvailableLogPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (-not (Test-Path $Path)) {
    return $Path
  }

  try {
    $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write, [System.IO.FileShare]::ReadWrite)
    $stream.Dispose()
    return $Path
  } catch {
    $directory = Split-Path -Parent $Path
    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($Path)
    $extension = [System.IO.Path]::GetExtension($Path)
    $suffix = Get-Date -Format 'yyyyMMdd-HHmmss'
    return Join-Path $directory ("{0}.{1}{2}" -f $baseName, $suffix, $extension)
  }
}

function Write-StackBanner {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  try {
    Add-Content -Path $Path -Value ("`n==== STACK START {0} ====`n" -f (Get-Date -Format s)) -ErrorAction Stop
  } catch {
    Write-Warning "Could not append stack banner to $Path. Continuing with process startup."
  }
}

$nginxScript = Join-Path $workspace 'scripts\start-mobile-codex-nginx.ps1'
$appLauncher = Join-Path $workspace 'scripts\start-mobile-codex.ps1'
$stopScript = Join-Path $workspace 'scripts\stop-mobile-codex-stack.ps1'
$repo = if ($env:MOBILE_CODEX_UPSTREAM_DIR) {
  $env:MOBILE_CODEX_UPSTREAM_DIR
} else {
  Join-Path $workspace 'vendor\claudecodeui-1.25.2'
}

if (-not (Test-Path $repo)) {
  throw "Upstream checkout not found: $repo"
}

$node = if ($env:MOBILE_CODEX_NODE) {
  $env:MOBILE_CODEX_NODE
} else {
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCmd) {
    throw 'Node.js 22 LTS not found on PATH. Set MOBILE_CODEX_NODE if needed.'
  }
  $nodeCmd.Path
}

$logDir = Join-Path $workspace 'tmp\logs'
$runtimeDir = Join-Path $workspace '.runtime'
$stdoutLog = Join-Path $logDir 'mobile-codex-app.stdout.log'
$stderrLog = Join-Path $logDir 'mobile-codex-app.stderr.log'
$bindingFile = Join-Path $runtimeDir 'app-binding.json'
$existingBinding = Load-AppBinding -Path $bindingFile

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
Write-StackBanner -Path $stdoutLog
Write-StackBanner -Path $stderrLog

try {
  # Remove stale listeners from previous launches before starting a fresh stack.
  & $powershellExe -NoProfile -ExecutionPolicy Bypass -File $stopScript | Out-Null

  $bindHost = Resolve-AppBindHost
  $publicHost = Resolve-AppPublicHost -BindHost $bindHost
  if (($publicHost -eq '127.0.0.1' -or -not $publicHost) -and $existingBinding -and $existingBinding.host) {
    $existingHost = [string]$existingBinding.host
    if ($existingHost -and $existingHost -notin @('127.0.0.1', '0.0.0.0')) {
      $publicHost = $existingHost
    }
  }
  $bindMode = if ($bindHost -eq '127.0.0.1') { 'localhost' } else { 'tailscale-direct' }
  $appHealthUrl = if ($bindMode -eq 'localhost') { 'http://127.0.0.1:3001/health' } else { 'http://127.0.0.1:3001/health' }
  $directUrl = "http://${publicHost}:3001"
  $httpsPublication = Resolve-TailscaleHttpsPublication
  if (-not $httpsPublication) {
    $httpsPublication = Get-PreservedHttpsPublication -Binding $existingBinding
  }
  $serveUrl = if ($httpsPublication) { $httpsPublication.url } else { $null }
  $recommendedUrl = if ($serveUrl) { $serveUrl } else { $directUrl }
  $bindingInfo = @{
    host = $publicHost
    port = 3001
    mode = $bindMode
    url = $recommendedUrl
    preferredUrl = $recommendedUrl
    directUrl = $directUrl
    serveUrl = $serveUrl
    funnelUrl = if ($httpsPublication -and $httpsPublication.visibility -eq 'public-funnel') { $httpsPublication.url } else { $null }
    remoteVisibility = if ($httpsPublication) { $httpsPublication.visibility } elseif ($bindMode -eq 'tailscale-direct') { 'tailnet-ip' } else { 'local-only' }
    requiresTailscaleClient = if ($httpsPublication) { [bool]$httpsPublication.requiresTailscaleClient } elseif ($bindMode -eq 'tailscale-direct') { $true } else { $false }
    updatedAt = (Get-Date).ToString('o')
  } | ConvertTo-Json -Depth 3
  Set-Content -Path $bindingFile -Value $bindingInfo -Encoding UTF8

  $appEnv = @{
    NODE_ENV = 'production'
    HOST = $bindHost
    PORT = '3001'
    CODEX_ONLY_HARDENED_MODE = 'true'
    VITE_CODEX_ONLY_HARDENED_MODE = 'true'
    MOBILE_CODEX_ENABLE_DESKTOP_APPROVAL_BRIDGE = 'true'
    MOBILE_CODEX_DESKTOP_APPROVAL_MAX_AGE_MS = '300000'
    MOBILE_CODEX_NODE = $node
    MOBILE_CODEX_UPSTREAM_DIR = $repo
    DATABASE_PATH = (Join-Path $runtimeDir 'auth.db')
  }

  foreach ($entry in $appEnv.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
  }

  Normalize-ProcessPathEnvironment

  # Launch a short-lived cmd/start helper so the app gets its own detached
  # process tree and the stack script can still return after health verification.
  $detachedLaunchArgs = '/c start "" /min "{0}" -NoProfile -ExecutionPolicy Bypass -File "{1}"' -f $powershellExe, $appLauncher
  Start-Process -FilePath $cmdExe -ArgumentList $detachedLaunchArgs -WorkingDirectory $workspace -WindowStyle Hidden | Out-Null

  Wait-HealthyEndpoint -Uri $appHealthUrl -Name 'mobileCodex app'

  if ($bindMode -eq 'localhost') {
    try {
      & $powershellExe -NoProfile -ExecutionPolicy Bypass -File $nginxScript | Out-Null
      Wait-HealthyEndpoint -Uri 'http://127.0.0.1:8080/health' -Name 'mobileCodex nginx proxy' -TimeoutSeconds 10
    } catch {
      Write-Warning "nginx proxy did not start cleanly. Remote Tailscale access now targets 127.0.0.1:3001 directly, so the app stack will continue without nginx."
    }
  } else {
    Write-Warning "Direct Tailscale binding is active on ${publicHost}:3001. nginx startup is skipped."
  }
} catch {
  & $powershellExe -NoProfile -ExecutionPolicy Bypass -File $stopScript | Out-Null
  throw
}
