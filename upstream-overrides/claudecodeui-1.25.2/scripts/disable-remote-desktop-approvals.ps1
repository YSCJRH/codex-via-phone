$workspace = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $workspace '.runtime'
$windowPath = Join-Path $runtimeDir 'desktop-approval-bridge-window.json'

if (Test-Path $windowPath) {
  Remove-Item -LiteralPath $windowPath -Force
}

Write-Output 'Remote desktop approvals disabled.'
