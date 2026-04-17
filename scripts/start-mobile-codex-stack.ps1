$workspace = Split-Path -Parent $PSScriptRoot
$powershellExe = Join-Path $PSHOME 'powershell.exe'
$cmdExe = Join-Path $env:SystemRoot 'System32\cmd.exe'
. (Join-Path $PSScriptRoot 'lib\mobile-codex-common.ps1')

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

  return '127.0.0.1'
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
        mode = if ($tailnetOnly) { 'tailnet-private' } else { 'public-funnel' }
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

  $existingVisibility = ConvertTo-MobileCodexModeName ([string]$Binding.remoteVisibility)
  if ($existingVisibility -notin @('public-funnel', 'tailnet-private')) {
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
    mode = $existingVisibility
    requiresTailscaleClient = if ($null -ne $Binding.requiresTailscaleClient) {
      [bool]$Binding.requiresTailscaleClient
    } else {
      $existingVisibility -eq 'tailnet-private'
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
$modeConfig = Get-MobileCodexModeConfig

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
Write-StackBanner -Path $stdoutLog
Write-StackBanner -Path $stderrLog

try {
  # Remove stale listeners from previous launches before starting a fresh stack.
  & $powershellExe -NoProfile -ExecutionPolicy Bypass -File $stopScript | Out-Null

  $bindHost = Resolve-AppBindHost
  $bindMode = if (Test-MobileCodexLoopbackHost -Host $bindHost) { [string]$modeConfig.effectiveMode } else { 'legacy-direct' }
  $publicHost = if ($bindMode -eq 'legacy-direct') { Resolve-AppPublicHost -BindHost $bindHost } else { '127.0.0.1' }
  $appHealthUrl = 'http://127.0.0.1:3001/health'
  $directUrl = 'http://127.0.0.1:3001'
  $httpsPublication = Resolve-TailscaleHttpsPublication
  if (-not $httpsPublication) {
    $httpsPublication = Get-PreservedHttpsPublication -Binding $existingBinding
  }
  $publishedMode = if ($httpsPublication) { [string]$httpsPublication.mode } else { $bindMode }
  $serveUrl = if ($httpsPublication -and $httpsPublication.mode -eq 'tailnet-private') { $httpsPublication.url } else { $null }
  $funnelUrl = if ($httpsPublication -and $httpsPublication.mode -eq 'public-funnel') { $httpsPublication.url } else { $null }
  $preferredUrl = if ($publishedMode -eq 'public-funnel' -and $funnelUrl) {
    $funnelUrl
  } elseif ($publishedMode -eq 'tailnet-private' -and $serveUrl) {
    $serveUrl
  } elseif ($bindMode -eq 'legacy-direct') {
    "http://${publicHost}:3001"
  } else {
    $directUrl
  }
  $bindingInfo = @{
    host = if ($bindMode -eq 'legacy-direct') { $publicHost } else { '127.0.0.1' }
    port = 3001
    mode = $bindMode
    url = $preferredUrl
    preferredUrl = $preferredUrl
    directUrl = $directUrl
    serveUrl = $serveUrl
    funnelUrl = $funnelUrl
    remoteVisibility = $publishedMode
    requiresTailscaleClient = if ($httpsPublication) { [bool]$httpsPublication.requiresTailscaleClient } elseif ($bindMode -eq 'tailnet-private' -or $bindMode -eq 'legacy-direct') { $true } else { $false }
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

  if ($bindMode -ne 'legacy-direct') {
    try {
      & $powershellExe -NoProfile -ExecutionPolicy Bypass -File $nginxScript | Out-Null
      Wait-HealthyEndpoint -Uri 'http://127.0.0.1:8080/health' -Name 'mobileCodex nginx proxy' -TimeoutSeconds 10
    } catch {
      throw "nginx proxy did not start cleanly. localhost, tailnet-private, and public-funnel modes require nginx on 127.0.0.1:8080."
    }
  } else {
    Write-Warning "Legacy direct binding is active on ${publicHost}:3001. This mode is deprecated and outside the default boundary."
  }
} catch {
  & $powershellExe -NoProfile -ExecutionPolicy Bypass -File $stopScript | Out-Null
  throw
}
