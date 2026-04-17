param(
  [int]$Minutes = 60
)

if ($Minutes -le 0) {
  throw 'Minutes must be greater than 0.'
}

$workspace = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $workspace '.runtime'
$windowPath = Join-Path $runtimeDir 'desktop-approval-bridge-window.json'

New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

$enabledAt = Get-Date
$enabledUntil = $enabledAt.AddMinutes($Minutes)
$payload = @{
  enabledAt = $enabledAt.ToString('o')
  enabledUntil = $enabledUntil.ToString('o')
  reason = 'desktop-opt-in'
} | ConvertTo-Json -Depth 3

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($windowPath, $payload, $utf8NoBom)
Write-Output ("Remote desktop approvals enabled until {0}" -f $enabledUntil.ToString('u'))
