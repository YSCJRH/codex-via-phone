$workspace = Split-Path -Parent $PSScriptRoot
$repo = if ($env:MOBILE_CODEX_UPSTREAM_DIR) {
  $env:MOBILE_CODEX_UPSTREAM_DIR
} else {
  Join-Path $workspace 'vendor\claudecodeui-1.25.2'
}

if (-not (Test-Path $repo)) {
  throw "Upstream checkout not found: $repo"
}

$node = if ($env:MOBILE_CODEX_NODE) {
  $env:MOBILE_CODEX_NODE
} else {
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCmd) {
    throw 'Node.js 22 LTS not found on PATH. Set MOBILE_CODEX_NODE if needed.'
  }
  $nodeCmd.Path
}

$logDir = Join-Path $workspace 'tmp\logs'
$runtimeDir = Join-Path $workspace '.runtime'
$stdoutLog = Join-Path $logDir 'mobile-codex-app.stdout.log'
$stderrLog = Join-Path $logDir 'mobile-codex-app.stderr.log'

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
Add-Content -Path $stdoutLog -Value ("`n==== START {0} ====`n" -f (Get-Date -Format s))
Add-Content -Path $stderrLog -Value ("`n==== START {0} ====`n" -f (Get-Date -Format s))

if (-not $env:NODE_ENV) {
  $env:NODE_ENV = 'production'
}

if (-not $env:HOST) {
  $env:HOST = '127.0.0.1'
}

if (-not $env:PORT) {
  $env:PORT = '3001'
}

if (-not $env:CODEX_ONLY_HARDENED_MODE) {
  $env:CODEX_ONLY_HARDENED_MODE = 'true'
}

if (-not $env:VITE_CODEX_ONLY_HARDENED_MODE) {
  $env:VITE_CODEX_ONLY_HARDENED_MODE = 'true'
}

if (-not $env:MOBILE_CODEX_ENABLE_DESKTOP_APPROVAL_BRIDGE) {
  $env:MOBILE_CODEX_ENABLE_DESKTOP_APPROVAL_BRIDGE = 'true'
}

if (-not $env:MOBILE_CODEX_DESKTOP_APPROVAL_MAX_AGE_MS) {
  $env:MOBILE_CODEX_DESKTOP_APPROVAL_MAX_AGE_MS = '300000'
}

if (-not $env:DATABASE_PATH) {
  $env:DATABASE_PATH = Join-Path $runtimeDir 'auth.db'
}

Set-Location $repo
& $node 'server/index.js' 1>> $stdoutLog 2>> $stderrLog
