$tailscale = if ($env:MOBILE_CODEX_TAILSCALE) {
  $env:MOBILE_CODEX_TAILSCALE
} else {
  'C:\Program Files\Tailscale\tailscale.exe'
}

$workspace = Split-Path -Parent $PSScriptRoot
$bindingFile = Join-Path $workspace '.runtime\app-binding.json'

if (-not (Test-Path $tailscale)) {
  throw "Tailscale CLI not found: $tailscale"
}

$status = & $tailscale status --json | ConvertFrom-Json
if ($status.BackendState -ne 'Running') {
  if ($status.AuthURL) {
    Write-Output "Tailscale login required: $($status.AuthURL)"
    exit 1
  }

  throw 'Tailscale is not running yet.'
}

$certDomains = @($status.CertDomains | Where-Object { $_ })
if (($null -eq $status.CertDomains) -or ($certDomains.Count -eq 0)) {
  $tailnetName = if ($status.CurrentTailnet.Name) { $status.CurrentTailnet.Name } else { 'current tailnet' }
  $dnsName = if ($status.Self.DNSName) { $status.Self.DNSName.TrimEnd('.') } else { $status.Self.HostName }
  Write-Output "Tailscale Serve HTTPS is not enabled for $tailnetName yet."
  Write-Output "Enable HTTPS/certificates for this tailnet in the Tailscale admin console, then re-run this script."
  if ($dnsName) {
    Write-Output "Expected node DNS name: $dnsName"
  }
  exit 1
}

$appHost = '127.0.0.1'
$appPort = 3001
$appMode = 'localhost'
if (Test-Path $bindingFile) {
  try {
    $binding = Get-Content -Raw -Path $bindingFile | ConvertFrom-Json
    if ($binding.host) {
      $appHost = [string]$binding.host
    }
    if ($binding.port) {
      $appPort = [int]$binding.port
    }
    if ($binding.mode) {
      $appMode = [string]$binding.mode
    }
  } catch {
  }
}

$proxyHost = if ($appMode -eq 'tailscale-direct') { '127.0.0.1' } else { $appHost }
$proxyTarget = "http://$proxyHost`:$appPort"

function Invoke-TailscalePublish {
  param(
    [string[]]$Arguments,
    [string]$FriendlyName
  )

  $publishOutput = & $tailscale @Arguments 2>&1
  $publishText = ($publishOutput | Out-String).Trim()

  if ($publishText -match 'https://login\.tailscale\.com/f/(?:serve|funnel)\?[^\s]+') {
    Write-Output "$FriendlyName must be approved on your tailnet first: $($Matches[0])"
    exit 1
  }

  if ($LASTEXITCODE -ne 0) {
    if ($publishText) {
      throw $publishText
    }

    throw "Failed to configure $FriendlyName."
  }
}

function Get-HttpsPublicationInfo {
  param(
    [string]$StatusText
  )

  $httpsLine = $StatusText -split "`r?`n" | Where-Object { $_ -match '^https://[^\s]+' } | Select-Object -First 1
  if (-not $httpsLine) {
    return $null
  }

  $match = [regex]::Match($httpsLine.Trim(), '^(https://[^\s]+)(?:\s+\(([^)]+)\))?')
  if (-not $match.Success) {
    return $null
  }

  $label = if ($match.Groups[2].Success) { $match.Groups[2].Value.ToLowerInvariant() } else { '' }
  $tailnetOnly = $label.Contains('tailnet only')
  return [pscustomobject]@{
    url = $match.Groups[1].Value.TrimEnd('/')
    visibility = if ($tailnetOnly) { 'tailnet-only' } else { 'public-funnel' }
    requiresTailscaleClient = $tailnetOnly
  }
}

try {
  & $tailscale funnel reset 2>$null | Out-Null
} catch {
}

try {
  & $tailscale serve reset 2>$null | Out-Null
} catch {
}

Invoke-TailscalePublish -Arguments @('funnel', '--yes', '--bg', $proxyTarget) -FriendlyName 'Tailscale Funnel'
Invoke-TailscalePublish -Arguments @('serve', '--http=8081', '--yes', '--bg', $proxyTarget) -FriendlyName 'Tailscale tailnet fallback'

$statusText = (& $tailscale funnel status 2>&1 | Out-String).Trim()
$publication = Get-HttpsPublicationInfo -StatusText $statusText

if (-not $publication) {
  throw 'Tailscale Funnel did not publish an HTTPS endpoint.'
}

if ($publication.visibility -ne 'public-funnel') {
  throw 'Tailscale Funnel is still tailnet-only. Tailnet approval or policy is still blocking public internet access.'
}

if (Test-Path $bindingFile) {
  try {
    $binding = Get-Content -Raw -Path $bindingFile | ConvertFrom-Json
  } catch {
    $binding = [pscustomobject]@{}
  }

  $binding | Add-Member -NotePropertyName url -NotePropertyValue $publication.url -Force
  $binding | Add-Member -NotePropertyName preferredUrl -NotePropertyValue $publication.url -Force
  $binding | Add-Member -NotePropertyName serveUrl -NotePropertyValue $publication.url -Force
  $binding | Add-Member -NotePropertyName funnelUrl -NotePropertyValue $publication.url -Force
  $binding | Add-Member -NotePropertyName remoteVisibility -NotePropertyValue $publication.visibility -Force
  $binding | Add-Member -NotePropertyName requiresTailscaleClient -NotePropertyValue ([bool]$publication.requiresTailscaleClient) -Force
  $binding | Add-Member -NotePropertyName updatedAt -NotePropertyValue ((Get-Date).ToString('o')) -Force
  $binding | ConvertTo-Json -Depth 4 | Set-Content -Path $bindingFile -Encoding UTF8
}

Write-Output $statusText
