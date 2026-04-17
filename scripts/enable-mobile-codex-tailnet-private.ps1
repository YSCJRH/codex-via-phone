$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\mobile-codex-common.ps1')

$tailscale = Resolve-MobileCodexTailscaleCommand
if (-not $tailscale) {
  throw 'Tailscale CLI not found. Install Tailscale before enabling tailnet-private mode.'
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
    throw 'Tailscale HTTPS certificates are not enabled for this tailnet. tailnet-private requires Tailscale Serve HTTPS.'
  }
}

function Assert-ProxyHealthy {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $proxyHealthUrl -TimeoutSec 5
    if ($response.StatusCode -ne 200) {
      throw "Unexpected status code: $($response.StatusCode)"
    }
  } catch {
    throw "tailnet-private mode requires nginx on 127.0.0.1:8080. Health probe failed for $proxyHealthUrl"
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
  if ($LASTEXITCODE -ne 0) {
    $text = $output.Trim()
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

Invoke-TailscaleCommand -Arguments @('serve', '--bg', 'http://127.0.0.1:8080') -FriendlyName 'tailnet-private mode'

$statusText = (& $tailscale serve status 2>&1 | Out-String).Trim()
$publication = Get-MobileCodexPublicationStatus -StatusText $statusText
if (-not $publication) {
  throw 'tailnet-private mode did not produce a Tailscale Serve HTTPS endpoint.'
}

if ($publication.mode -ne 'tailnet-private') {
  throw 'tailnet-private mode unexpectedly resolved to a public Funnel endpoint. Funnel must stay disabled.'
}

Save-MobileCodexModeConfig -RequestedMode 'tailnet-private' -EffectiveMode 'tailnet-private' -PersistentRemotePublish $false -AllowedOrigins (Get-MobileCodexAllowedOrigins -Mode 'tailnet-private' -PublishedUrl $publication.url) | Out-Null
Update-MobileCodexBindingMode -Mode 'tailnet-private' -PreferredUrl $publication.url -PublishedUrl $publication.url

Write-Output "Mode: tailnet-private"
Write-Output "Route: $($publication.url)"
Write-Output 'Funnel: disabled'
