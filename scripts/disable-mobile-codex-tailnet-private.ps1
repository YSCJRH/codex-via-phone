$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\mobile-codex-common.ps1')

$tailscale = Resolve-MobileCodexTailscaleCommand
if ($tailscale) {
  try {
    & $tailscale funnel reset 2>$null | Out-Null
  } catch {
  }

  try {
    & $tailscale serve reset 2>$null | Out-Null
  } catch {
  }
}

Save-MobileCodexModeConfig -RequestedMode 'localhost' -EffectiveMode 'localhost' -PersistentRemotePublish $false -AllowedOrigins (Get-MobileCodexAllowedOrigins -Mode 'localhost') | Out-Null
Update-MobileCodexBindingMode -Mode 'localhost' -PreferredUrl 'http://127.0.0.1:3001'

Write-Output 'Mode: localhost'
Write-Output 'tailnet-private publication has been disabled.'
