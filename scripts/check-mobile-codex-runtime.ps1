$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\mobile-codex-common.ps1')

$summary = Get-MobileCodexRuntimeSummary

[PSCustomObject]@{
  Workspace = $summary.Workspace
  UpstreamExists = $summary.UpstreamExists
  UpstreamPath = $summary.UpstreamPath
  Node = $summary.Node
  Npm = $summary.Npm
  Nginx = $summary.Nginx
  Tailscale = $summary.Tailscale
  Python = $summary.Python
} | Format-List
