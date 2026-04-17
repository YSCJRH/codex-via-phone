$ErrorActionPreference = 'Stop'

function Get-MobileCodexWorkspace {
  return Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
}

function Get-MobileCodexRuntimeDir {
  return Join-Path (Get-MobileCodexWorkspace) '.runtime'
}

function Get-MobileCodexModeConfigPath {
  return Join-Path (Get-MobileCodexRuntimeDir) 'mode-config.json'
}

function Get-MobileCodexBindingPath {
  return Join-Path (Get-MobileCodexRuntimeDir) 'app-binding.json'
}

function Read-MobileCodexJsonObject {
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

function Write-MobileCodexJsonObject {
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

  $Data | ConvertTo-Json -Depth 8 | Set-Content -Path $Path -Encoding UTF8
}

function Test-MobileCodexLoopbackHost {
  param(
    [string]$Host
  )

  if (-not $Host) {
    return $true
  }

  return $Host.Trim().ToLowerInvariant() -in @('127.0.0.1', 'localhost', '::1')
}

function Get-MobileCodexModeDefaults {
  return [ordered]@{
    requestedMode = 'localhost'
    effectiveMode = 'localhost'
    persistentRemotePublish = $false
    confirmedAt = $null
    confirmedByInstallerVersion = $null
    legacyStateDetected = $false
  }
}

function ConvertTo-MobileCodexModeName {
  param(
    [string]$Value
  )

  $normalized = [string]$Value
  $normalized = $normalized.Trim().ToLowerInvariant()

  switch ($normalized) {
    '' { return 'localhost' }
    'localhost' { return 'localhost' }
    'local-only' { return 'localhost' }
    'tailnet-private' { return 'tailnet-private' }
    'tailnet-only' { return 'tailnet-private' }
    'public-funnel' { return 'public-funnel' }
    'tailscale-direct' { return 'legacy-direct' }
    'tailnet-ip' { return 'legacy-direct' }
    'direct' { return 'legacy-direct' }
    'legacy-direct' { return 'legacy-direct' }
    default { return $normalized }
  }
}

function Get-MobileCodexModeConfig {
  $defaults = Get-MobileCodexModeDefaults
  $configPath = Get-MobileCodexModeConfigPath
  $bindingPath = Get-MobileCodexBindingPath

  $rawConfig = Read-MobileCodexJsonObject -Path $configPath
  $binding = Read-MobileCodexJsonObject -Path $bindingPath

  $requestedMode = ConvertTo-MobileCodexModeName ($rawConfig.requestedMode)
  $effectiveMode = ConvertTo-MobileCodexModeName ($rawConfig.effectiveMode)
  $persistentRemotePublish = if ($null -ne $rawConfig.persistentRemotePublish) { [bool]$rawConfig.persistentRemotePublish } else { $defaults.persistentRemotePublish }
  $confirmedAt = if ($rawConfig.confirmedAt) { [string]$rawConfig.confirmedAt } else { $defaults.confirmedAt }
  $confirmedByInstallerVersion = if ($rawConfig.confirmedByInstallerVersion) { [string]$rawConfig.confirmedByInstallerVersion } else { $defaults.confirmedByInstallerVersion }
  $legacyStateDetected = if ($null -ne $rawConfig.legacyStateDetected) { [bool]$rawConfig.legacyStateDetected } else { $defaults.legacyStateDetected }

  if ($binding) {
    $bindingMode = ConvertTo-MobileCodexModeName ([string]$binding.mode)
    $bindingVisibility = ConvertTo-MobileCodexModeName ([string]$binding.remoteVisibility)
    $bindingHost = [string]$binding.host

    if ($bindingVisibility -in @('tailnet-private', 'public-funnel')) {
      $requestedMode = $bindingVisibility
      $effectiveMode = $bindingVisibility
    } elseif ($bindingMode -in @('tailnet-private', 'public-funnel', 'legacy-direct')) {
      $requestedMode = $bindingMode
      $effectiveMode = $bindingMode
    } elseif (-not (Test-MobileCodexLoopbackHost -Host $bindingHost)) {
      $requestedMode = 'legacy-direct'
      $effectiveMode = 'legacy-direct'
      $legacyStateDetected = $true
    }

    if ($bindingMode -eq 'legacy-direct' -or $bindingVisibility -eq 'legacy-direct') {
      $legacyStateDetected = $true
    }
  }

  if ($effectiveMode -eq 'legacy-direct') {
    $legacyStateDetected = $true
  }

  return [ordered]@{
    requestedMode = if ($requestedMode) { $requestedMode } else { $defaults.requestedMode }
    effectiveMode = if ($effectiveMode) { $effectiveMode } else { $defaults.effectiveMode }
    persistentRemotePublish = $persistentRemotePublish
    confirmedAt = $confirmedAt
    confirmedByInstallerVersion = $confirmedByInstallerVersion
    legacyStateDetected = $legacyStateDetected
  }
}

function Save-MobileCodexModeConfig {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('localhost', 'tailnet-private', 'public-funnel', 'legacy-direct')]
    [string]$RequestedMode,
    [Parameter(Mandatory = $true)]
    [ValidateSet('localhost', 'tailnet-private', 'public-funnel', 'legacy-direct')]
    [string]$EffectiveMode,
    [bool]$PersistentRemotePublish = $false,
    [string]$ConfirmedByInstallerVersion = 'manual-script-v1'
  )

  $config = [ordered]@{
    requestedMode = $RequestedMode
    effectiveMode = $EffectiveMode
    persistentRemotePublish = $PersistentRemotePublish
    confirmedAt = (Get-Date).ToString('o')
    confirmedByInstallerVersion = $ConfirmedByInstallerVersion
    legacyStateDetected = ($EffectiveMode -eq 'legacy-direct')
  }

  Write-MobileCodexJsonObject -Path (Get-MobileCodexModeConfigPath) -Data $config
  return $config
}

function Resolve-MobileCodexTailscaleCommand {
  if ($env:MOBILE_CODEX_TAILSCALE -and (Test-Path $env:MOBILE_CODEX_TAILSCALE)) {
    return $env:MOBILE_CODEX_TAILSCALE
  }

  $default = 'C:\Program Files\Tailscale\tailscale.exe'
  if (Test-Path $default) {
    return $default
  }

  return $null
}

function Get-MobileCodexPublicationStatus {
  param(
    [string]$StatusText
  )

  if (-not $StatusText) {
    return $null
  }

  $httpsLine = $StatusText -split "`r?`n" | Where-Object { $_ -match '^https://[^\s]+' } | Select-Object -First 1
  if (-not $httpsLine) {
    return $null
  }

  $match = [regex]::Match($httpsLine.Trim(), '^(https://[^\s]+)(?:\s+\(([^)]+)\))?')
  if (-not $match.Success) {
    return $null
  }

  $label = if ($match.Groups[2].Success) { $match.Groups[2].Value.ToLowerInvariant() } else { '' }
  $mode = if ($label.Contains('tailnet only')) { 'tailnet-private' } else { 'public-funnel' }
  return [pscustomobject]@{
    url = $match.Groups[1].Value.TrimEnd('/')
    mode = $mode
    requiresTailscaleClient = ($mode -eq 'tailnet-private')
  }
}

function Update-MobileCodexBindingMode {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('localhost', 'tailnet-private', 'public-funnel', 'legacy-direct')]
    [string]$Mode,
    [string]$PreferredUrl = $null,
    [string]$PublishedUrl = $null
  )

  $bindingPath = Get-MobileCodexBindingPath
  $binding = Read-MobileCodexJsonObject -Path $bindingPath
  if (-not $binding) {
    $binding = [ordered]@{
      host = '127.0.0.1'
      port = 3001
      mode = 'localhost'
      url = 'http://127.0.0.1:3001'
      preferredUrl = 'http://127.0.0.1:3001'
      directUrl = 'http://127.0.0.1:3001'
      serveUrl = $null
      funnelUrl = $null
      remoteVisibility = 'localhost'
      requiresTailscaleClient = $false
      updatedAt = (Get-Date).ToString('o')
    }
  }

  $binding.host = '127.0.0.1'
  $binding.port = 3001
  $binding.mode = $Mode
  $binding.updatedAt = (Get-Date).ToString('o')

  switch ($Mode) {
    'localhost' {
      $binding.url = 'http://127.0.0.1:3001'
      $binding.preferredUrl = 'http://127.0.0.1:3001'
      $binding.directUrl = 'http://127.0.0.1:3001'
      $binding.serveUrl = $null
      $binding.funnelUrl = $null
      $binding.remoteVisibility = 'localhost'
      $binding.requiresTailscaleClient = $false
    }
    'tailnet-private' {
      $binding.url = if ($PreferredUrl) { $PreferredUrl } else { $binding.url }
      $binding.preferredUrl = if ($PreferredUrl) { $PreferredUrl } else { $binding.preferredUrl }
      $binding.directUrl = 'http://127.0.0.1:3001'
      $binding.serveUrl = $PublishedUrl
      $binding.funnelUrl = $null
      $binding.remoteVisibility = 'tailnet-private'
      $binding.requiresTailscaleClient = $true
    }
    'public-funnel' {
      $binding.url = if ($PreferredUrl) { $PreferredUrl } else { $binding.url }
      $binding.preferredUrl = if ($PreferredUrl) { $PreferredUrl } else { $binding.preferredUrl }
      $binding.directUrl = 'http://127.0.0.1:3001'
      $binding.serveUrl = $null
      $binding.funnelUrl = $PublishedUrl
      $binding.remoteVisibility = 'public-funnel'
      $binding.requiresTailscaleClient = $false
    }
    'legacy-direct' {
      $binding.remoteVisibility = 'legacy-direct'
      $binding.requiresTailscaleClient = $true
    }
  }

  Write-MobileCodexJsonObject -Path $bindingPath -Data ([ordered]@{
      host = $binding.host
      port = $binding.port
      mode = $binding.mode
      url = $binding.url
      preferredUrl = $binding.preferredUrl
      directUrl = $binding.directUrl
      serveUrl = $binding.serveUrl
      funnelUrl = $binding.funnelUrl
      remoteVisibility = $binding.remoteVisibility
      requiresTailscaleClient = [bool]$binding.requiresTailscaleClient
      updatedAt = $binding.updatedAt
    })
}
