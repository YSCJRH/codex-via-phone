[CmdletBinding()]
param(
  [string]$OutputDir = '',
  [switch]$DryRun,
  [switch]$EmitJson,
  [switch]$IncludeSensitiveRaw
)

$ErrorActionPreference = 'Stop'
$supportBundleScript = Join-Path $PSScriptRoot 'export-mobile-codex-support-bundle.ps1'
$powershellExe = Join-Path $PSHOME 'powershell.exe'

if ($IncludeSensitiveRaw) {
  [Console]::Error.WriteLine('Sensitive raw audit export is no longer enabled by default. Use the redacted support bundle path instead.')
  exit 3
}

if (-not (Test-Path $supportBundleScript)) {
  [Console]::Error.WriteLine("Support bundle script not found: $supportBundleScript")
  exit 10
}

$arguments = @()
if ($OutputDir) {
  $arguments += @('-OutputDir', $OutputDir)
}
if ($DryRun) {
  $arguments += '-DryRun'
}
if ($EmitJson) {
  $arguments += '-EmitJson'
}

$output = & $powershellExe -NoProfile -ExecutionPolicy Bypass -File $supportBundleScript @arguments 2>&1 | Out-String
$exitCode = $LASTEXITCODE
if ($null -eq $exitCode) {
  $exitCode = 10
}

if ($EmitJson) {
  if ($output.Trim()) {
    $output.Trim()
  }
  exit $exitCode
}

Write-Output 'export-mobile-codex-audit.ps1 now exports the default redacted support bundle.'
if ($output.Trim()) {
  Write-Output $output.Trim()
}
exit $exitCode
