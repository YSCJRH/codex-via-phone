$tailscale = if ($env:MOBILE_CODEX_TAILSCALE) {
  $env:MOBILE_CODEX_TAILSCALE
} else {
  'C:\Program Files\Tailscale\tailscale.exe'
}

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

$tailIp = @($status.Self.TailscaleIPs | Where-Object { $_ -match '^100\.' }) | Select-Object -First 1
if (-not $tailIp) {
  throw 'No Tailscale IPv4 address was found for this machine.'
}

$helperService = Get-Service -Name 'iphlpsvc' -ErrorAction SilentlyContinue
if (-not $helperService) {
  throw 'Windows IP Helper service was not found.'
}

if ($helperService.Status -ne 'Running') {
  Start-Service -Name 'iphlpsvc'
}

$showOutput = & netsh interface portproxy show v4tov4
foreach ($line in ($showOutput -split "`r?`n")) {
  if ($line -match '^\s*(100\.\d{1,3}\.\d{1,3}\.\d{1,3})\s+3001\s+127\.0\.0\.1\s+3001\s*$') {
    $listenAddress = $Matches[1]
    & netsh interface portproxy delete v4tov4 listenaddress=$listenAddress listenport=3001 | Out-Null
  }
}

& netsh interface portproxy add v4tov4 listenaddress=$tailIp listenport=3001 connectaddress=127.0.0.1 connectport=3001

$ruleName = 'MobileCodexTailnet3001'
$existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existingRule) {
  $existingRule | Remove-NetFirewallRule
}

New-NetFirewallRule `
  -DisplayName $ruleName `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalAddress $tailIp `
  -LocalPort 3001 `
  -Profile Any | Out-Null

Write-Output "Tailnet direct access enabled: http://$tailIp:3001/"
