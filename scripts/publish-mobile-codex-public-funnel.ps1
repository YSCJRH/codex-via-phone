[CmdletBinding()]
param(
  [switch]$Yes,
  [switch]$AllowPersistentRemotePublish
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\mobile-codex-common.ps1')

$tailscale = Resolve-MobileCodexTailscaleCommand
if (-not $tailscale) {
  throw 'Tailscale CLI not found. Install Tailscale before publishing public-funnel mode.'
}

if (-not $Yes) {
  Write-Host 'DANGER: public-funnel creates a PUBLIC INTERNET ENTRYPOINT.' -ForegroundColor Red
  Write-Host 'Run this script again with -Yes only if you explicitly want a public-funnel.' -ForegroundColor Red
  exit 3
}

$proxyHealthUrl = 'http://127.0.0.1:8080/health'

function Assert-TailscaleReady {
  $status = & $tailscale status --json | ConvertFrom-Json
  if ($status.BackendState -ne 'Running') {
    if ($status.AuthURL) {
      Write-Output "Tailscale login required: $($status.AuthURL)"
      exit 2
    }

    throw 'Tailscale is not running yet.'
  }

  $certDomains = @($status.CertDomains | Where-Object { $_ })
  if ($certDomains.Count -eq 0) {
    throw 'Tailscale HTTPS certificates are not enabled for this tailnet. public-funnel requires Tailscale Serve/Funnel HTTPS.'
  }
}

function Assert-ProxyHealthy {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $proxyHealthUrl -TimeoutSec 5
    if ($response.StatusCode -ne 200) {
      throw "Unexpected status code: $($response.StatusCode)"
    }
  } catch {
    throw "public-funnel mode requires nginx on 127.0.0.1:8080. Health probe failed for $proxyHealthUrl"
  }
}

function Invoke-TailscaleCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,
    [Parameter(Mandatory = $true)]
    [string]$FriendlyName
  )

  $output = & $tailscale @Arguments 2>&1 | Out-String
  $text = $output.Trim()

  if ($text -match 'https://login\.tailscale\.com/f/(?:serve|funnel)\?[^\s]+') {
    Write-Output "$FriendlyName requires tailnet admin approval first: $($Matches[0])"
    exit 3
  }

  if ($LASTEXITCODE -ne 0) {
    if ($text) {
      throw $text
    }

    throw "Failed to configure $FriendlyName."
  }
}

Assert-TailscaleReady
Assert-ProxyHealthy

try {
  & $tailscale funnel reset 2>$null | Out-Null
} catch {
}

try {
  & $tailscale serve reset 2>$null | Out-Null
} catch {
}

Invoke-TailscaleCommand -Arguments @('funnel', '--yes', '--bg', 'http://127.0.0.1:8080') -FriendlyName 'public-funnel mode'

$statusText = (& $tailscale funnel status 2>&1 | Out-String).Trim()
$publication = Get-MobileCodexPublicationStatus -StatusText $statusText
if (-not $publication) {
  throw 'public-funnel mode did not publish an HTTPS endpoint.'
}

if ($publication.mode -ne 'public-funnel') {
  throw 'public-funnel mode is still tailnet-private. Public internet publication was not confirmed by Tailscale.'
}

Save-MobileCodexModeConfig -RequestedMode 'public-funnel' -EffectiveMode 'public-funnel' -PersistentRemotePublish ([bool]$AllowPersistentRemotePublish) -AllowedOrigins (Get-MobileCodexAllowedOrigins -Mode 'public-funnel' -PublishedUrl $publication.url) | Out-Null
Update-MobileCodexBindingMode -Mode 'public-funnel' -PreferredUrl $publication.url -PublishedUrl $publication.url

Write-Host 'PUBLIC INTERNET ENTRYPOINT ENABLED' -ForegroundColor Red
Write-Output "Mode: public-funnel"
Write-Output "Route: $($publication.url)"
Write-Output "Persistent public-funnel: $([bool]$AllowPersistentRemotePublish)"
