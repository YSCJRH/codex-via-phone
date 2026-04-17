[CmdletBinding()]
param(
  [ValidateSet('manual', 'startup', 'watchdog')]
  [string]$Trigger = 'manual'
)

$ErrorActionPreference = 'Stop'

$workspace = Split-Path -Parent $PSScriptRoot
$powershellExe = Join-Path $PSHOME 'powershell.exe'
$runtimeDir = Join-Path $workspace '.runtime'
$cacheDir = Join-Path $runtimeDir 'cache'
$configPath = Join-Path $runtimeDir 'auto-start.json'
$statePath = Join-Path $runtimeDir 'auto-start-state.json'
$bindingPath = Join-Path $runtimeDir 'app-binding.json'
$lockPath = Join-Path $cacheDir 'ensure-stack.lock'
$startScript = Join-Path $PSScriptRoot 'start-mobile-codex-stack.ps1'
$remoteScript = Join-Path $PSScriptRoot 'publish-mobile-codex-public-funnel.ps1'
$appHealthUrl = 'http://127.0.0.1:3001/health'
$lockTtlSeconds = 600

function Get-DefaultAutoStartConfig {
  return [ordered]@{
    enabled = $true
    startupDelaySeconds = 45
    watchdogIntervalMinutes = 5
    ensureRemotePublish = $false
    restartCooldownSeconds = 120
    preserveKnownPublicBinding = $false
  }
}

function Get-DefaultAutoStartState {
  param(
    [hashtable]$Config
  )

  return [ordered]@{
    lastRunAt = $null
    lastResult = 'not-run'
    lastAction = 'not-run'
    lastError = $null
    appHealthy = $null
    remoteIntent = [bool]$Config.ensureRemotePublish
    trigger = $null
  }
}

function Read-JsonObject {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (-not (Test-Path $Path)) {
    return $null
  }

  try {
    return Get-Content -Raw -Path $Path | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Write-JsonObject {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [hashtable]$Data
  )

  $parent = Split-Path -Parent $Path
  if ($parent) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }
  $Data | ConvertTo-Json -Depth 6 | Set-Content -Path $Path -Encoding UTF8
}

function ConvertTo-Bool {
  param(
    $Value,
    [bool]$Default
  )

  if ($null -eq $Value) {
    return $Default
  }
  return [bool]$Value
}

function ConvertTo-PositiveInt {
  param(
    $Value,
    [int]$Default
  )

  try {
    $converted = [int]$Value
    if ($converted -gt 0) {
      return $converted
    }
  } catch {
  }

  return $Default
}

function Load-AutoStartConfig {
  $defaults = Get-DefaultAutoStartConfig
  $raw = Read-JsonObject -Path $configPath
  $installed = Test-Path $configPath

  $config = [ordered]@{
    enabled = ConvertTo-Bool ($raw.enabled) $defaults.enabled
    startupDelaySeconds = ConvertTo-PositiveInt ($raw.startupDelaySeconds) $defaults.startupDelaySeconds
    watchdogIntervalMinutes = ConvertTo-PositiveInt ($raw.watchdogIntervalMinutes) $defaults.watchdogIntervalMinutes
    ensureRemotePublish = ConvertTo-Bool ($raw.ensureRemotePublish) $defaults.ensureRemotePublish
    restartCooldownSeconds = ConvertTo-PositiveInt ($raw.restartCooldownSeconds) $defaults.restartCooldownSeconds
    preserveKnownPublicBinding = ConvertTo-Bool ($raw.preserveKnownPublicBinding) $defaults.preserveKnownPublicBinding
  }

  return @{
    installed = $installed
    config = $config
  }
}

function Load-AutoStartState {
  param(
    [hashtable]$Config
  )

  $raw = Read-JsonObject -Path $statePath
  $state = Get-DefaultAutoStartState -Config $Config
  if (-not $raw) {
    return $state
  }

  foreach ($key in @($state.Keys)) {
    if ($raw.PSObject.Properties.Name -contains $key) {
      $state[$key] = $raw.$key
    }
  }

  return $state
}

function Parse-IsoDateTime {
  param(
    $Value
  )

  if (-not $Value) {
    return $null
  }

  try {
    return [datetimeoffset]::Parse([string]$Value)
  } catch {
    return $null
  }
}

function Test-AppHealthy {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $appHealthUrl -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Get-AppBinding {
  return Read-JsonObject -Path $bindingPath
}

function Test-PublicBinding {
  param(
    $Binding
  )

  if (-not $Binding) {
    return $false
  }

  $visibility = [string]$Binding.remoteVisibility
  if ($visibility -ne 'public-funnel') {
    return $false
  }

  foreach ($candidate in @($Binding.funnelUrl, $Binding.serveUrl, $Binding.url)) {
    $text = [string]$candidate
    if ($text -and $text.StartsWith('https://')) {
      return $true
    }
  }

  return $false
}

function Invoke-PowerShellScript {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ScriptPath,
    [string[]]$Arguments = @()
  )

  $output = & $powershellExe -NoProfile -ExecutionPolicy Bypass -File $ScriptPath @Arguments 2>&1 | Out-String
  return @{
    exitCode = $LASTEXITCODE
    output = $output.Trim()
  }
}

function Acquire-ExecutionLock {
  New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null

  if (Test-Path $lockPath) {
    $staleBefore = (Get-Date).ToUniversalTime().AddSeconds(-$lockTtlSeconds)
    try {
      $lockFile = Get-Item -LiteralPath $lockPath -ErrorAction Stop
      if ($lockFile.LastWriteTimeUtc -lt $staleBefore) {
        Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
      }
    } catch {
    }
  }

  try {
    $stream = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    $payload = @{
      acquiredAt = (Get-Date).ToString('o')
      trigger = $Trigger
      pid = $PID
    } | ConvertTo-Json -Depth 3
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
    return $stream
  } catch {
    return $null
  }
}

function Complete-Execution {
  param(
    [hashtable]$State,
    [int]$ExitCode = 0
  )

  $script:finalState = $State
  $script:finalExitCode = $ExitCode
  throw [System.OperationCanceledException]::new('__MOBILE_CODEX_COMPLETE__')
}

$configPayload = Load-AutoStartConfig
$config = $configPayload.config

$previousState = Load-AutoStartState -Config $config
$state = Get-DefaultAutoStartState -Config $config
$finalState = $null
$finalExitCode = 0
$state.lastRunAt = (Get-Date).ToString('o')
$state.trigger = $Trigger
$state.remoteIntent = [bool]$config.ensureRemotePublish

if (-not $config.enabled) {
  $state.lastResult = 'disabled'
  $state.lastAction = 'disabled'
  $state.appHealthy = Test-AppHealthy
  Write-JsonObject -Path $statePath -Data $state
  exit 0
}

$lockHandle = Acquire-ExecutionLock
if (-not $lockHandle) {
  $state.lastResult = 'lock-busy'
  $state.lastAction = 'skip-lock'
  $state.lastError = $null
  $state.appHealthy = Test-AppHealthy
  Write-JsonObject -Path $statePath -Data $state
  exit 0
}

try {
  $appHealthy = Test-AppHealthy
  $state.appHealthy = $appHealthy

  $binding = Get-AppBinding
  $bindingIsPublic = Test-PublicBinding -Binding $binding
  $previousRemoteMissing = [string]$previousState.lastResult -in @('remote-publish-missing', 'remote-publish-failed')

  if ($appHealthy -and (-not $config.ensureRemotePublish -or (-not $previousRemoteMissing) -or ($bindingIsPublic -and $config.preserveKnownPublicBinding))) {
  $state.lastResult = 'healthy'
  $state.lastAction = 'health-check'
  Complete-Execution -State $state -ExitCode 0
}

  if (-not $appHealthy) {
    $previousRunAt = Parse-IsoDateTime -Value $previousState.lastRunAt
    $previousAction = [string]$previousState.lastAction
    $recentStartAttempt = $previousAction -in @('start-stack', 'start-stack+ensure-remote')
    if ($recentStartAttempt -and $previousRunAt) {
      $cooldownUntil = $previousRunAt.AddSeconds([int]$config.restartCooldownSeconds)
      if ((Get-Date) -lt $cooldownUntil.LocalDateTime) {
        $state.lastResult = 'cooldown-skip'
        $state.lastAction = 'skip-cooldown'
        $state.lastError = $null
        Complete-Execution -State $state -ExitCode 0
      }
    }

    $startResult = Invoke-PowerShellScript -ScriptPath $startScript
    $state.lastAction = 'start-stack'
    if ($startResult.exitCode -ne 0) {
      $state.lastResult = 'start-failed'
      $state.lastError = $startResult.output
      $state.appHealthy = Test-AppHealthy
      Complete-Execution -State $state -ExitCode 1
    }

    $appHealthy = Test-AppHealthy
    $state.appHealthy = $appHealthy
    if (-not $appHealthy) {
      $state.lastResult = 'start-failed'
      $state.lastError = 'Start script returned success, but /health is still unavailable.'
      Complete-Execution -State $state -ExitCode 1
    }

    $binding = Get-AppBinding
    $bindingIsPublic = Test-PublicBinding -Binding $binding
  }

  $shouldEnsureRemote = $false
  if ($config.ensureRemotePublish) {
    if (-not $bindingIsPublic) {
      $shouldEnsureRemote = $true
    }
    if ($previousRemoteMissing) {
      $shouldEnsureRemote = $true
    }
    if ($bindingIsPublic -and $config.preserveKnownPublicBinding) {
      $shouldEnsureRemote = $false
    }
  }

  if ($shouldEnsureRemote) {
    $state.lastAction = if ($state.lastAction -eq 'start-stack') { 'start-stack+ensure-remote' } else { 'ensure-remote' }
    $remoteResult = Invoke-PowerShellScript -ScriptPath $remoteScript -Arguments @('-Yes', '-AllowPersistentRemotePublish')
    if ($remoteResult.exitCode -ne 0) {
      $state.lastResult = 'remote-publish-failed'
      $state.lastError = $remoteResult.output
      Complete-Execution -State $state -ExitCode 1
    }

    $binding = Get-AppBinding
    $bindingIsPublic = Test-PublicBinding -Binding $binding
    if (-not $bindingIsPublic) {
      $state.lastResult = 'remote-publish-missing'
      $state.lastError = 'public-funnel command completed, but app-binding.json is still not marked as public-funnel.'
      Complete-Execution -State $state -ExitCode 1
    }

    $state.lastResult = if ($state.lastAction -eq 'start-stack+ensure-remote') { 'started-and-published' } else { 'remote-publish-restored' }
    $state.lastError = $null
    Complete-Execution -State $state -ExitCode 0
  }

  $state.lastResult = if ($state.lastAction -eq 'start-stack') { 'started' } else { 'healthy' }
  if (-not $state.lastAction -or $state.lastAction -eq 'not-run') {
    $state.lastAction = 'health-check'
  }
  $state.lastError = $null
  Complete-Execution -State $state -ExitCode 0
} catch [System.OperationCanceledException] {
  if ($_.Exception.Message -ne '__MOBILE_CODEX_COMPLETE__') {
    $state.lastResult = 'ensure-failed'
    $state.lastAction = if ($state.lastAction -and $state.lastAction -ne 'not-run') { $state.lastAction } else { 'ensure-stack' }
    $state.lastError = $_.Exception.Message
    $state.appHealthy = Test-AppHealthy
    $finalState = $state
    $finalExitCode = 1
  }
} catch {
  $state.lastResult = 'ensure-failed'
  $state.lastAction = if ($state.lastAction -and $state.lastAction -ne 'not-run') { $state.lastAction } else { 'ensure-stack' }
  $state.lastError = $_.Exception.Message
  $state.appHealthy = Test-AppHealthy
  $finalState = $state
  $finalExitCode = 1
} finally {
  if ($lockHandle) {
    try {
      $lockHandle.Dispose()
    } catch {
    }
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
  }
}

if ($finalState) {
  Write-JsonObject -Path $statePath -Data $finalState
  exit $finalExitCode
}
