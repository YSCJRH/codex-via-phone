[CmdletBinding()]
param(
  [ValidateSet('localhost', 'tailnet-private', 'public-funnel')]
  [string]$Mode = 'localhost',
  [switch]$DryRun,
  [switch]$Yes,
  [switch]$NoStart,
  [switch]$EmitPlanJson,
  [switch]$EmitRedactedStatus,
  [switch]$AllowPersistentRemotePublish
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\mobile-codex-common.ps1')

$installerVersion = 'install-mobile-codex.ps1-v1'
$workspace = Get-MobileCodexWorkspace
$runtimeDir = Get-MobileCodexRuntimeDir
$modeConfigPath = Get-MobileCodexModeConfigPath
$bindingPath = Get-MobileCodexBindingPath
$autoStartConfigPath = Join-Path $runtimeDir 'auto-start.json'
$overrideRoot = Join-Path $workspace 'upstream-overrides\claudecodeui-1.25.2'
$applyOverridesScript = Join-Path $PSScriptRoot 'apply-upstream-overrides.ps1'
$runtimeCheckScript = Join-Path $PSScriptRoot 'check-mobile-codex-runtime.ps1'
$startStackScript = Join-Path $PSScriptRoot 'start-mobile-codex-stack.ps1'
$tailnetPrivateScript = Join-Path $PSScriptRoot 'enable-mobile-codex-tailnet-private.ps1'
$publicFunnelScript = Join-Path $PSScriptRoot 'publish-mobile-codex-public-funnel.ps1'
$localhostScript = Join-Path $PSScriptRoot 'disable-mobile-codex-tailnet-private.ps1'
$statusScript = Join-Path $PSScriptRoot 'status-mobile-codex.ps1'
$powershellExe = Join-Path $PSHOME 'powershell.exe'
$runtimeSummary = Get-MobileCodexRuntimeSummary
$modeConfig = Get-MobileCodexModeConfig
$persistentPublic = ($Mode -eq 'public-funnel' -and [bool]$AllowPersistentRemotePublish)
$planEmitted = $false
$phases = @(
  [ordered]@{ name = 'validate-upstream'; status = 'pending'; detail = 'Validate upstream source and installer prerequisites.' },
  [ordered]@{ name = 'apply-overrides'; status = 'pending'; detail = 'Apply repository overrides onto the upstream checkout.' },
  [ordered]@{ name = 'install-deps'; status = 'pending'; detail = 'Install upstream Node dependencies.' },
  [ordered]@{ name = 'doctor'; status = 'pending'; detail = 'Run runtime checks and boundary sanity checks.' },
  [ordered]@{ name = 'configure-mode'; status = 'pending'; detail = 'Persist the requested access mode into mode-config.json.' },
  [ordered]@{ name = 'start'; status = if ($NoStart) { 'skipped' } else { 'pending' }; detail = if ($NoStart) { 'Skipped because -NoStart was requested.' } else { 'Start the local stack and enable the selected mode.' } },
  [ordered]@{ name = 'verify'; status = 'pending'; detail = 'Verify the resulting boundary state.' },
  [ordered]@{ name = 'emit-redacted-status'; status = if ($EmitRedactedStatus) { 'pending' } else { 'skipped' }; detail = if ($EmitRedactedStatus) { 'Emit a redacted status summary.' } else { 'Skipped because -EmitRedactedStatus was not requested.' } }
)

function Set-PhaseStatus {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [string]$Status,
    [string]$Detail = ''
  )

  foreach ($phase in $phases) {
    if ($phase.name -eq $Name) {
      $phase.status = $Status
      if ($Detail) {
        $phase.detail = $Detail
      }
      return
    }
  }
}

function Get-DisplayPath {
  param(
    [string]$Path
  )

  if (-not $Path) {
    return $null
  }

  $workspacePath = (Resolve-Path -LiteralPath $workspace).Path
  $candidate = $Path
  try {
    if (Test-Path $Path) {
      $candidate = (Resolve-Path -LiteralPath $Path).Path
    }
  } catch {
  }

  if ($candidate.StartsWith($workspacePath, [System.StringComparison]::OrdinalIgnoreCase)) {
    $relative = $candidate.Substring($workspacePath.Length).TrimStart('\')
    if (-not $relative) {
      return '.'
    }
    return ($relative -replace '\\', '/')
  }

  if ($candidate -eq $runtimeSummary.UpstreamPath) {
    return '<UPSTREAM_DIR>'
  }

  return '<external>'
}

function Get-PlanPayload {
  $commands = @(
    'validate-upstream',
    'apply-upstream-overrides.ps1',
    'npm install',
    'check-mobile-codex-runtime.ps1',
    "configure-mode:$Mode"
  )

  if ($NoStart) {
    $commands += 'start:skipped'
  } else {
    $commands += 'start-mobile-codex-stack.ps1'
  }

  if (($Mode -eq 'tailnet-private') -and (-not $NoStart)) {
    $commands += 'enable-mobile-codex-tailnet-private.ps1'
  }

  if (($Mode -eq 'public-funnel') -and (-not $NoStart)) {
    $commands += 'publish-mobile-codex-public-funnel.ps1 -Yes'
  }

  if ($EmitRedactedStatus) {
    $commands += 'status-mobile-codex.ps1 -EmitJson'
  }

  $fileChanges = @(
    [ordered]@{ path = 'upstream-overrides/claudecodeui-1.25.2'; action = 'read' },
    [ordered]@{ path = (Get-DisplayPath $runtimeSummary.UpstreamPath); action = 'update-upstream' },
    [ordered]@{ path = (Get-DisplayPath $modeConfigPath); action = 'write-mode-config' },
    [ordered]@{ path = (Get-DisplayPath $bindingPath); action = 'write-binding' },
    [ordered]@{ path = '.runtime/auto-start.json'; action = 'update-if-present' }
  )

  return [ordered]@{
    installerVersion = $installerVersion
    mode = $Mode
    dryRun = [bool]$DryRun
    noStart = [bool]$NoStart
    emitPlanJson = [bool]$EmitPlanJson
    emitRedactedStatus = [bool]$EmitRedactedStatus
    allowPersistentRemotePublish = [bool]$persistentPublic
    requiresConfirmation = ($Mode -eq 'public-funnel' -and -not $Yes)
    legacyStateDetected = [bool]$modeConfig.legacyStateDetected
    workspace = '.'
    upstreamPath = (Get-DisplayPath $runtimeSummary.UpstreamPath)
    phases = $phases
    fileChanges = $fileChanges
    commands = $commands
  }
}

function Emit-PlanIfRequested {
  if ($EmitPlanJson -and -not $planEmitted) {
    (Get-PlanPayload) | ConvertTo-Json -Depth 8
    $script:planEmitted = $true
  }
}

function Write-InstallerErrorMessage {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Message
  )

  [Console]::Error.WriteLine($Message)
}

function Invoke-InstallerScript {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ScriptPath,
    [string[]]$Arguments = @()
  )

  $output = & $powershellExe -NoProfile -ExecutionPolicy Bypass -File $ScriptPath @Arguments 2>&1 | Out-String
  return [ordered]@{
    exitCode = $LASTEXITCODE
    output = $output.Trim()
  }
}

function Invoke-NpmInstall {
  param(
    [Parameter(Mandatory = $true)]
    [string]$WorkingDirectory,
    [Parameter(Mandatory = $true)]
    [string]$NpmPath
  )

  Push-Location $WorkingDirectory
  try {
    $output = & $NpmPath install 2>&1 | Out-String
    return [ordered]@{
      exitCode = $LASTEXITCODE
      output = $output.Trim()
    }
  } finally {
    Pop-Location
  }
}

function Update-AutoStartConfigFromMode {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('localhost', 'tailnet-private', 'public-funnel')]
    [string]$RequestedMode,
    [bool]$PersistentRemotePublish
  )

  if (-not (Test-Path $autoStartConfigPath)) {
    return $false
  }

  $existing = Read-MobileCodexJsonObject -Path $autoStartConfigPath
  $desiredEnsureRemotePublish = ($RequestedMode -eq 'public-funnel' -and $PersistentRemotePublish)

  $config = [ordered]@{
    enabled = if ($null -ne $existing.enabled) { [bool]$existing.enabled } else { $true }
    startupDelaySeconds = if ($null -ne $existing.startupDelaySeconds) { [int]$existing.startupDelaySeconds } else { 45 }
    watchdogIntervalMinutes = if ($null -ne $existing.watchdogIntervalMinutes) { [int]$existing.watchdogIntervalMinutes } else { 5 }
    ensureRemotePublish = $desiredEnsureRemotePublish
    restartCooldownSeconds = if ($null -ne $existing.restartCooldownSeconds) { [int]$existing.restartCooldownSeconds } else { 120 }
    preserveKnownPublicBinding = $false
  }

  Write-MobileCodexJsonObject -Path $autoStartConfigPath -Data $config
  return $true
}

function Configure-RequestedMode {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('localhost', 'tailnet-private', 'public-funnel')]
    [string]$RequestedMode,
    [bool]$PersistentRemotePublish
  )

  Reset-MobileCodexPublishedEntrypoints
  Save-MobileCodexModeConfig `
    -RequestedMode $RequestedMode `
    -EffectiveMode $RequestedMode `
    -PersistentRemotePublish $PersistentRemotePublish `
    -ConfirmedByInstallerVersion $installerVersion | Out-Null
  Update-MobileCodexBindingMode -Mode $RequestedMode -PreferredUrl 'http://127.0.0.1:3001'
  [void](Update-AutoStartConfigFromMode -RequestedMode $RequestedMode -PersistentRemotePublish $PersistentRemotePublish)
}

function Test-HealthyEndpoint {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Uri
  )

  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 5
    return ($response.StatusCode -eq 200)
  } catch {
    return $false
  }
}

function Assert-VerifiedMode {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('localhost', 'tailnet-private', 'public-funnel')]
    [string]$RequestedMode,
    [bool]$Started
  )

  $currentModeConfig = Get-MobileCodexModeConfig
  $binding = Read-MobileCodexJsonObject -Path $bindingPath

  if ([string]$currentModeConfig.requestedMode -ne $RequestedMode) {
    throw "mode-config.json requestedMode is $($currentModeConfig.requestedMode), expected $RequestedMode."
  }

  if ([string]$currentModeConfig.effectiveMode -ne $RequestedMode) {
    throw "mode-config.json effectiveMode is $($currentModeConfig.effectiveMode), expected $RequestedMode."
  }

  if (-not $binding) {
    throw 'app-binding.json was not written.'
  }

  if ([string]$binding.mode -ne $RequestedMode) {
    throw "app-binding.json mode is $($binding.mode), expected $RequestedMode."
  }

  if ($RequestedMode -eq 'localhost') {
    if ([string]$binding.remoteVisibility -ne 'localhost') {
      throw "app-binding.json remoteVisibility is $($binding.remoteVisibility), expected localhost."
    }
    if ($binding.funnelUrl -or $binding.serveUrl) {
      throw 'localhost mode should not keep a published HTTPS route in app-binding.json.'
    }
    if ($Started -and -not (Test-HealthyEndpoint -Uri 'http://127.0.0.1:3001/health')) {
      throw 'localhost mode did not pass the local app health check.'
    }
    return
  }

  if (-not $Started) {
    if ([string]$binding.remoteVisibility -ne $RequestedMode) {
      throw "Configured mode is $RequestedMode, but app-binding.json remoteVisibility is $($binding.remoteVisibility)."
    }
    return
  }

  if (-not (Test-HealthyEndpoint -Uri 'http://127.0.0.1:3001/health')) {
    throw 'The app health check failed after start.'
  }
  if (-not (Test-HealthyEndpoint -Uri 'http://127.0.0.1:8080/health')) {
    throw 'The nginx health check failed after start.'
  }

  if ($RequestedMode -eq 'tailnet-private') {
    if ([string]$binding.remoteVisibility -ne 'tailnet-private') {
      throw "tailnet-private mode verification failed: remoteVisibility is $($binding.remoteVisibility)."
    }
    if (-not ([string]$binding.serveUrl).StartsWith('https://')) {
      throw 'tailnet-private mode verification failed: serveUrl is missing.'
    }
    if ($binding.funnelUrl) {
      throw 'tailnet-private mode verification failed: funnelUrl should be empty.'
    }
    return
  }

  if ([string]$binding.remoteVisibility -ne 'public-funnel') {
    throw "public-funnel mode verification failed: remoteVisibility is $($binding.remoteVisibility)."
  }
  if (-not ([string]$binding.funnelUrl).StartsWith('https://')) {
    throw 'public-funnel mode verification failed: funnelUrl is missing.'
  }
}

function Emit-RedactedStatus {
  if (Test-Path $statusScript) {
    $statusResult = Invoke-InstallerScript -ScriptPath $statusScript -Arguments @('-EmitJson')
    if ($statusResult.exitCode -eq 0 -and $statusResult.output) {
      $statusResult.output
      return
    }
  }

  $pythonPath = $runtimeSummary.Python
  if (-not $pythonPath) {
    return
  }

  $previousDontWriteBytecode = $env:PYTHONDONTWRITEBYTECODE
  $env:PYTHONDONTWRITEBYTECODE = '1'
  try {
    $output = & $pythonPath (Join-Path $workspace 'mobile_codex_control.py') --json 2>&1 | Out-String
    if ($LASTEXITCODE -eq 0) {
      $output.Trim()
      return
    }
  } finally {
    if ($null -eq $previousDontWriteBytecode) {
      Remove-Item Env:\PYTHONDONTWRITEBYTECODE -ErrorAction SilentlyContinue
    } else {
      $env:PYTHONDONTWRITEBYTECODE = $previousDontWriteBytecode
    }
  }

  ([ordered]@{
      checkedAt = (Get-Date).ToString('o')
      localUrl = 'http://127.0.0.1:3001'
      mode = $Mode
      modeConfig = Get-MobileCodexModeConfig
      redacted = $true
    }) | ConvertTo-Json -Depth 6
}

$validateErrors = @()
if (-not (Test-Path $overrideRoot)) {
  $validateErrors += "Override root not found: $(Get-DisplayPath $overrideRoot)"
}
if (-not $runtimeSummary.UpstreamExists) {
  $validateErrors += "Upstream checkout not found at $(Get-DisplayPath $runtimeSummary.UpstreamPath)."
} elseif (-not (Test-Path (Join-Path $runtimeSummary.UpstreamPath 'package.json'))) {
  $validateErrors += "Upstream checkout at $(Get-DisplayPath $runtimeSummary.UpstreamPath) is missing package.json."
}
foreach ($requiredScript in @($applyOverridesScript, $runtimeCheckScript, $startStackScript, $localhostScript)) {
  if (-not (Test-Path $requiredScript)) {
    $validateErrors += "Required script not found: $(Get-DisplayPath $requiredScript)"
  }
}

$doctorErrors = @()
if (-not $runtimeSummary.Node) {
  $doctorErrors += 'Node.js was not found on PATH. Set MOBILE_CODEX_NODE if needed.'
}
if (-not $runtimeSummary.Npm) {
  $doctorErrors += 'npm was not found on PATH.'
}
if (-not $runtimeSummary.Nginx) {
  $doctorErrors += 'nginx was not found. Set MOBILE_CODEX_NGINX if needed.'
}
if (-not $runtimeSummary.Python) {
  $doctorErrors += 'Python was not found on PATH.'
}
if ($Mode -ne 'localhost' -and -not $runtimeSummary.Tailscale) {
  $doctorErrors += "Tailscale is required for $Mode."
}

if ([bool]$modeConfig.legacyStateDetected) {
  Set-PhaseStatus -Name 'validate-upstream' -Status 'blocked' -Detail 'Legacy direct boundary state detected. Manual migration is required before using the installer.'
  Emit-PlanIfRequested
  Write-InstallerErrorMessage 'Legacy direct boundary state detected. Migrate back to localhost or a reviewed mode before using install-mobile-codex.ps1.'
  exit 5
}

if ($Mode -eq 'public-funnel' -and -not $Yes) {
  Set-PhaseStatus -Name 'configure-mode' -Status 'blocked' -Detail 'public-funnel requires explicit confirmation with -Yes.'
  Emit-PlanIfRequested
  Write-InstallerErrorMessage 'public-funnel requires explicit confirmation. Re-run install-mobile-codex.ps1 with -Mode public-funnel -Yes to continue.'
  exit 3
}

if ($validateErrors.Count -gt 0) {
  Set-PhaseStatus -Name 'validate-upstream' -Status 'failed' -Detail ($validateErrors -join ' ')
  Emit-PlanIfRequested
  $validateErrors | ForEach-Object { Write-InstallerErrorMessage $_ }
  exit 2
}
Set-PhaseStatus -Name 'validate-upstream' -Status 'completed'

if ($doctorErrors.Count -gt 0) {
  Set-PhaseStatus -Name 'doctor' -Status 'failed' -Detail ($doctorErrors -join ' ')
  Emit-PlanIfRequested
  $doctorErrors | ForEach-Object { Write-InstallerErrorMessage $_ }
  exit 2
}
Set-PhaseStatus -Name 'doctor' -Status 'completed'

if ($DryRun) {
  Set-PhaseStatus -Name 'apply-overrides' -Status 'planned'
  Set-PhaseStatus -Name 'install-deps' -Status 'planned'
  Set-PhaseStatus -Name 'configure-mode' -Status 'planned'
  Set-PhaseStatus -Name 'verify' -Status 'planned'
  Emit-PlanIfRequested
  if (-not $EmitPlanJson) {
    Write-Output "Dry run ready. Mode = $Mode"
    Write-Output "Upstream = $(Get-DisplayPath $runtimeSummary.UpstreamPath)"
    Write-Output "Start phase = $([string](-not $NoStart))"
  }
  exit 0
}

Emit-PlanIfRequested

Write-Output "==> validate-upstream"
Write-Output "Mode: $Mode"
Write-Output "Upstream: $(Get-DisplayPath $runtimeSummary.UpstreamPath)"

Write-Output "==> apply-overrides"
$applyResult = Invoke-InstallerScript -ScriptPath $applyOverridesScript
if ($applyResult.exitCode -ne 0) {
  Set-PhaseStatus -Name 'apply-overrides' -Status 'failed' -Detail $applyResult.output
  if ($applyResult.output) {
    Write-InstallerErrorMessage $applyResult.output
  }
  exit 4
}
Set-PhaseStatus -Name 'apply-overrides' -Status 'completed'
if ($applyResult.output) {
  Write-Output $applyResult.output
}

Write-Output "==> install-deps"
$npmResult = Invoke-NpmInstall -WorkingDirectory $runtimeSummary.UpstreamPath -NpmPath $runtimeSummary.Npm
if ($npmResult.exitCode -ne 0) {
  Set-PhaseStatus -Name 'install-deps' -Status 'failed' -Detail $npmResult.output
  if ($npmResult.output) {
    Write-InstallerErrorMessage $npmResult.output
  }
  exit 2
}
Set-PhaseStatus -Name 'install-deps' -Status 'completed'
if ($npmResult.output) {
  Write-Output $npmResult.output
}

Write-Output "==> doctor"
$doctorResult = Invoke-InstallerScript -ScriptPath $runtimeCheckScript
if ($doctorResult.exitCode -ne 0) {
  Set-PhaseStatus -Name 'doctor' -Status 'failed' -Detail $doctorResult.output
  if ($doctorResult.output) {
    Write-InstallerErrorMessage $doctorResult.output
  }
  exit 2
}
Set-PhaseStatus -Name 'doctor' -Status 'completed'
if ($doctorResult.output) {
  Write-Output $doctorResult.output
}

Write-Output "==> configure-mode"
try {
  Configure-RequestedMode -RequestedMode $Mode -PersistentRemotePublish $persistentPublic
  Set-PhaseStatus -Name 'configure-mode' -Status 'completed'
} catch {
  Set-PhaseStatus -Name 'configure-mode' -Status 'failed' -Detail $_.Exception.Message
  Write-InstallerErrorMessage $_.Exception.Message
  exit 4
}

$started = $false
if (-not $NoStart) {
  Write-Output "==> start"
  $startResult = Invoke-InstallerScript -ScriptPath $startStackScript
  if ($startResult.exitCode -ne 0) {
    Set-PhaseStatus -Name 'start' -Status 'failed' -Detail $startResult.output
    if ($startResult.output) {
      Write-InstallerErrorMessage $startResult.output
    }
    exit 4
  }

  if ($Mode -eq 'tailnet-private') {
    $tailnetResult = Invoke-InstallerScript -ScriptPath $tailnetPrivateScript
    if ($tailnetResult.exitCode -ne 0) {
      Set-PhaseStatus -Name 'start' -Status 'failed' -Detail $tailnetResult.output
      if ($tailnetResult.output) {
        Write-InstallerErrorMessage $tailnetResult.output
      }
      if ($tailnetResult.exitCode -eq 2) {
        exit 2
      }
      exit 4
    }
    if ($tailnetResult.output) {
      Write-Output $tailnetResult.output
    }
  } elseif ($Mode -eq 'public-funnel') {
    $funnelArgs = @('-Yes')
    if ($persistentPublic) {
      $funnelArgs += '-AllowPersistentRemotePublish'
    }
    $publicResult = Invoke-InstallerScript -ScriptPath $publicFunnelScript -Arguments $funnelArgs
    if ($publicResult.exitCode -ne 0) {
      Set-PhaseStatus -Name 'start' -Status 'failed' -Detail $publicResult.output
      if ($publicResult.output) {
        Write-InstallerErrorMessage $publicResult.output
      }
      if ($publicResult.exitCode -eq 2) {
        exit 2
      }
      if ($publicResult.exitCode -eq 3) {
        exit 3
      }
      exit 4
    }
    if ($publicResult.output) {
      Write-Output $publicResult.output
    }
  } else {
    $localhostResult = Invoke-InstallerScript -ScriptPath $localhostScript
    if ($localhostResult.exitCode -ne 0) {
      Set-PhaseStatus -Name 'start' -Status 'failed' -Detail $localhostResult.output
      if ($localhostResult.output) {
        Write-InstallerErrorMessage $localhostResult.output
      }
      exit 4
    }
  }

  $started = $true
  Set-PhaseStatus -Name 'start' -Status 'completed'
}

Write-Output "==> verify"
try {
  Assert-VerifiedMode -RequestedMode $Mode -Started $started
  Set-PhaseStatus -Name 'verify' -Status 'completed'
} catch {
  Set-PhaseStatus -Name 'verify' -Status 'failed' -Detail $_.Exception.Message
  Write-InstallerErrorMessage $_.Exception.Message
  exit 4
}

if ($EmitRedactedStatus) {
  Set-PhaseStatus -Name 'emit-redacted-status' -Status 'completed'
  Write-Output "==> emit-redacted-status"
  Emit-RedactedStatus
}

Write-Output "Install completed. Mode = $Mode"
exit 0
