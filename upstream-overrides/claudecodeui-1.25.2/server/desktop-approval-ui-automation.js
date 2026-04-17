import { existsSync, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const UI_AUTOMATION_ENABLED = process.platform === 'win32'
  && process.env.MOBILE_CODEX_ENABLE_DESKTOP_UI_AUTOMATION !== 'false';
const POWERSHELL_TIMEOUT_MS = Number.parseInt(process.env.MOBILE_CODEX_DESKTOP_UI_TIMEOUT_MS || '', 10) || 25000;

function resolvePowerShellPath() {
  const explicitPath = typeof process.env.MOBILE_CODEX_POWERSHELL_PATH === 'string'
    ? process.env.MOBILE_CODEX_POWERSHELL_PATH.trim()
    : '';
  if (explicitPath) {
    return explicitPath;
  }

  if (process.platform !== 'win32') {
    return 'powershell';
  }

  const windowsRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const candidates = [
    `${windowsRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
    `${windowsRoot}\\Sysnative\\WindowsPowerShell\\v1.0\\powershell.exe`,
    'powershell.exe',
  ];

  return candidates.find((candidate) => candidate.includes(':\\') ? existsSync(candidate) : true) || 'powershell.exe';
}

const POWERSHELL_PATH = resolvePowerShellPath();

function normalizeOutput(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function stripClixmlNoise(value) {
  const text = normalizeOutput(value);
  if (!text) {
    return '';
  }

  return text
    .replace(/#<\s*CLIXML[\s\S]*$/i, '')
    .replace(/^Command failed:\s[\s\S]*?-EncodedCommand\s+\S+\s*/i, '')
    .trim();
}

function tryParseJsonOutput(value) {
  const text = normalizeOutput(value);
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function getUiAutomationFailureMessage(error) {
  if (error?.killed || error?.signal === 'SIGTERM') {
    return 'Desktop UI automation timed out while waiting for the Codex window to respond.';
  }

  const stderr = stripClixmlNoise(error?.stderr);
  if (stderr) {
    return stderr;
  }

  const stdout = stripClixmlNoise(error?.stdout);
  if (stdout) {
    return stdout;
  }

  const message = stripClixmlNoise(error?.message);
  if (message && !/^Command failed:/i.test(message)) {
    return message;
  }

  return 'Desktop UI automation failed before it could return a result.';
}

function toSafeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildPayload(approval, action) {
  return {
    action: toSafeString(action),
    requestId: toSafeString(approval?.requestId),
    title: toSafeString(approval?.title),
    message: toSafeString(approval?.message),
    command: toSafeString(approval?.input || approval?.metadata?.command),
    sessionId: toSafeString(approval?.sessionId),
    sessionSummary: toSafeString(approval?.metadata?.sessionSummary),
    projectLabel: toSafeString(approval?.metadata?.projectLabel),
    allowShortcutFallback: approval?.metadata?.allowShortcutFallback === true,
    allowThreadSwitch: approval?.metadata?.allowThreadSwitch === true,
  };
}

function buildPowerShellScript(payload) {
  const payloadBase64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

try {
  $payloadJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${payloadBase64}'))
  $payload = $payloadJson | ConvertFrom-Json

  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class MobileCodexNativeMethods {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@

  function Get-TrimmedString($value) {
    if ($null -eq $value) { return '' }
    return [string]$value
  }

  function Normalize-Text([string]$value) {
    if ([string]::IsNullOrWhiteSpace($value)) {
      return ''
    }

    $normalized = $value.Trim()
    $normalized = [regex]::Replace($normalized, '\\s+', ' ')
    $normalized = $normalized.Replace([char]0x2018, "'").Replace([char]0x2019, "'")
    $normalized = $normalized.Replace([char]0x201C, '"').Replace([char]0x201D, '"')
    return $normalized
  }

  function Add-SearchItem($list, [string]$candidate, [int]$minimumLength = 6) {
    $normalized = Normalize-Text $candidate
    if ([string]::IsNullOrWhiteSpace($normalized) -or $normalized.Length -lt $minimumLength) {
      return
    }

    if (-not $list.Contains($normalized)) {
      [void]$list.Add($normalized)
    }
  }

  function Add-SearchToken($list, [string]$candidate) {
    $normalized = Normalize-Text $candidate
    if ([string]::IsNullOrWhiteSpace($normalized) -or $normalized.Length -lt 5) {
      return
    }

    $lower = $normalized.ToLowerInvariant()
    if (-not $list.Contains($lower)) {
      [void]$list.Add($lower)
    }
  }

  function Get-DistinctiveTokens([string]$value) {
    $stopWords = @(
      'allow', 'approval', 'approve', 'button', 'codex', 'computer', 'connection', 'desktop',
      'file', 'files', 'harmless', 'latest', 'mobile', 'preview', 'prompt', 'readonly',
      'read-only', 'remote', 'system', 'thread', 'verify', 'windows'
    )
    $tokens = New-Object System.Collections.Generic.List[string]
    $normalized = Normalize-Text $value
    if ([string]::IsNullOrWhiteSpace($normalized)) {
      return $tokens
    }

    $parts = $normalized -split '[^\\p{L}\\p{N}_:\\-\\\\/\\$]+'
    foreach ($part in $parts) {
      $token = Normalize-Text $part
      if ([string]::IsNullOrWhiteSpace($token) -or $token.Length -lt 5) {
        continue
      }

      $lower = $token.ToLowerInvariant()
      if ($stopWords -contains $lower) {
        continue
      }

      Add-SearchToken $tokens $lower

      if ($token -match '[\\\\/]') {
        $leaf = ($token -split '[\\\\/]')[-1]
        Add-SearchToken $tokens $leaf
      }
    }

    return $tokens | Select-Object -First 12
  }

  function Get-SearchTerms($request) {
    $strictTerms = New-Object System.Collections.Generic.List[string]
    $softTerms = New-Object System.Collections.Generic.List[string]
    $tokens = New-Object System.Collections.Generic.List[string]

    foreach ($candidate in @(
      (Normalize-Text (Get-TrimmedString $request.command)),
      (Normalize-Text (Get-TrimmedString $request.message)),
      (Normalize-Text (Get-TrimmedString $request.title))
    )) {
      if ([string]::IsNullOrWhiteSpace($candidate)) {
        continue
      }

      Add-SearchItem $strictTerms $candidate 8

      if ($candidate.Length -gt 48) {
        Add-SearchItem $softTerms $candidate.Substring(0, 48) 12
      }

      foreach ($fragment in ($candidate -split '(?<=[,;:])\\s+|\\s{2,}')) {
        Add-SearchItem $softTerms $fragment 12
      }

      foreach ($token in Get-DistinctiveTokens $candidate) {
        Add-SearchToken $tokens $token
      }
    }

    return [PSCustomObject]@{
      StrictTerms = $strictTerms | Select-Object -Unique
      SoftTerms = $softTerms | Select-Object -Unique
      Tokens = $tokens | Select-Object -Unique
    }
  }

  function Get-SessionNavigationSearchProfile($request) {
    $sessionSummary = Normalize-Text (Get-TrimmedString $request.sessionSummary)
    $projectLabel = Normalize-Text (Get-TrimmedString $request.projectLabel)
    $sessionId = Normalize-Text (Get-TrimmedString $request.sessionId)

    if (
      [string]::IsNullOrWhiteSpace($sessionSummary) -and
      [string]::IsNullOrWhiteSpace($projectLabel) -and
      [string]::IsNullOrWhiteSpace($sessionId)
    ) {
      return $null
    }

    return Get-SearchTerms ([PSCustomObject]@{
      command = $sessionSummary
      message = $projectLabel
      title = $(if (-not [string]::IsNullOrWhiteSpace($sessionId)) { $sessionId } else { $sessionSummary })
    })
  }

  function Get-AutomationLocator($element) {
    if (-not $element) {
      return ''
    }

    try {
      return Normalize-Text $element.Current.AutomationId
    } catch {
      return ''
    }
  }

  function Test-LocatorMatch($element, [string]$locator) {
    if ([string]::IsNullOrWhiteSpace($locator) -or -not $element) {
      return $false
    }

    $name = Get-ElementName $element
    if (-not [string]::IsNullOrWhiteSpace($name) -and $name -eq $locator) {
      return $true
    }

    $automationId = Get-AutomationLocator $element
    if (-not [string]::IsNullOrWhiteSpace($automationId) -and $automationId -eq $locator) {
      return $true
    }

    return $false
  }

  function Find-LocatorControl($rootElement, [string]$locator) {
    if (-not $rootElement -or [string]::IsNullOrWhiteSpace($locator)) {
      return $null
    }

    if (Test-LocatorMatch $rootElement $locator) {
      return $rootElement
    }

    $elements = $rootElement.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition
    )

    foreach ($element in $elements) {
      if (Test-LocatorMatch $element $locator) {
        return $element
      }
    }

    return $null
  }

  function Read-CombinedElementText($element) {
    $texts = Get-ElementSearchTexts $element
    if (-not $texts -or $texts.Count -eq 0) {
      return ''
    }

    return (($texts | Select-Object -Unique) -join ' ').Trim()
  }

  function Test-WorkflowSessionActivated($rootElement, [string]$sessionId, [string]$previousMainCta, [string]$previousActionDetail) {
    if (-not $rootElement) {
      return $false
    }

    $timeline = Find-LocatorControl $rootElement 'workflow.timeline_view'
    if ($timeline) {
      $timelineText = Read-CombinedElementText $timeline
      if (-not [string]::IsNullOrWhiteSpace($sessionId) -and $timelineText.IndexOf($sessionId, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
        return $true
      }
    }

    $mainCta = Find-LocatorControl $rootElement 'workflow.main_cta'
    $actionDetail = Find-LocatorControl $rootElement 'workflow.action_detail'
    $currentMainCta = Read-CombinedElementText $mainCta
    $currentActionDetail = Read-CombinedElementText $actionDetail

    if (
      (-not [string]::IsNullOrWhiteSpace($currentMainCta) -and $currentMainCta -ne $previousMainCta) -or
      (-not [string]::IsNullOrWhiteSpace($currentActionDetail) -and $currentActionDetail -ne $previousActionDetail)
    ) {
      return $true
    }

    return $false
  }

  function Get-ElementRectangle($element) {
    try {
      return $element.Current.BoundingRectangle
    } catch {
      return $null
    }
  }

  function Get-ClickableControlTypeWeight([string]$controlType) {
    switch ($controlType) {
      'ControlType.ListItem' { return 5 }
      'ControlType.TreeItem' { return 5 }
      'ControlType.DataItem' { return 4 }
      'ControlType.Button' { return 4 }
      'ControlType.Hyperlink' { return 3 }
      'ControlType.TabItem' { return 3 }
      'ControlType.Custom' { return 2 }
      default { return 1 }
    }
  }

  function Get-OpenCodexProcess {
    return Get-Process -Name Codex -ErrorAction SilentlyContinue |
      Where-Object { $_.MainWindowHandle -and $_.MainWindowHandle -ne 0 } |
      Sort-Object StartTime -Descending |
      Select-Object -First 1
  }

  function Get-OpenWorkflowShellProcess {
    $candidates = Get-Process -ErrorAction SilentlyContinue |
      Where-Object { $_.MainWindowHandle -and $_.MainWindowHandle -ne 0 } |
      Where-Object {
        $title = Get-TrimmedString $_.MainWindowTitle
        if ([string]::IsNullOrWhiteSpace($title)) {
          return $false
        }

        return (
          $title.IndexOf('Chemistry SciWriter', [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -or
          $title.IndexOf('Workflow', [System.StringComparison]::OrdinalIgnoreCase) -ge 0
        )
      } |
      Sort-Object StartTime -Descending

    foreach ($candidate in $candidates) {
      try {
        $root = [System.Windows.Automation.AutomationElement]::FromHandle($candidate.MainWindowHandle)
        if (-not $root) {
          continue
        }

        if (Find-LocatorControl $root 'workflow.recent_sessions_list') {
          return $candidate
        }
      } catch {
      }
    }

    return $null
  }

  function Get-ElementName($element) {
    try {
      return Normalize-Text $element.Current.Name
    } catch {
      return ''
    }
  }

  function Get-ControlTypeName($element) {
    try {
      return [string]$element.Current.ControlType.ProgrammaticName
    } catch {
      return ''
    }
  }

  function Get-ElementSearchTexts($element) {
    $texts = New-Object System.Collections.Generic.List[string]

    Add-SearchItem $texts (Get-ElementName $element) 1

    try {
      Add-SearchItem $texts $element.Current.HelpText 1
    } catch {
    }

    try {
      $valuePattern = $element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
      if ($valuePattern) {
        Add-SearchItem $texts $valuePattern.Current.Value 1
      }
    } catch {
    }

    try {
      $legacyPattern = $element.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern)
      if ($legacyPattern) {
        Add-SearchItem $texts $legacyPattern.Current.Name 1
        Add-SearchItem $texts $legacyPattern.Current.Value 1
      }
    } catch {
    }

    return $texts | Select-Object -Unique
  }

  function Get-TextMatchScore($texts, $searchProfile) {
    if (-not $texts -or $texts.Count -eq 0) {
      return 0
    }

    $score = 0

    foreach ($text in $texts) {
      $normalizedText = Normalize-Text $text
      if ([string]::IsNullOrWhiteSpace($normalizedText)) {
        continue
      }

      foreach ($term in $searchProfile.StrictTerms) {
        if (-not [string]::IsNullOrWhiteSpace($term) -and $normalizedText.IndexOf($term, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
          $score += 6
        }
      }

      foreach ($term in $searchProfile.SoftTerms) {
        if (-not [string]::IsNullOrWhiteSpace($term) -and $normalizedText.IndexOf($term, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
          $score += 3
        }
      }

      $tokenMatches = 0
      foreach ($token in $searchProfile.Tokens) {
        if (-not [string]::IsNullOrWhiteSpace($token) -and $normalizedText.IndexOf($token, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
          $tokenMatches += 1
        }
      }

      if ($tokenMatches -ge 2) {
        $score += ($tokenMatches * 2)
      }
    }

    return $score
  }

  function Get-ContainerAggregateTexts($container) {
    $texts = New-Object System.Collections.Generic.List[string]
    foreach ($text in (Get-ElementSearchTexts $container)) {
      Add-SearchItem $texts $text 1
    }

    $descendants = $container.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition
    )

    foreach ($descendant in $descendants) {
      foreach ($text in (Get-ElementSearchTexts $descendant)) {
        Add-SearchItem $texts $text 1
      }

      if ($texts.Count -ge 64) {
        break
      }
    }

    return $texts | Select-Object -Unique
  }

  function Get-ApprovalContainerHeuristicScore($texts) {
    if (-not $texts -or $texts.Count -eq 0) {
      return 0
    }

    $score = 0
    foreach ($text in $texts) {
      $normalizedText = Normalize-Text $text
      if ([string]::IsNullOrWhiteSpace($normalizedText)) {
        continue
      }

      if ($normalizedText.IndexOf('do you want', [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
        $score += 2
      }
      if ($normalizedText.IndexOf('allow', [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
        $score += 2
      }
      if ($normalizedText.IndexOf('approval', [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
        $score += 2
      }
      if ($normalizedText.IndexOf('approve', [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
        $score += 2
      }
      if ($normalizedText.IndexOf('deny', [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
        $score += 1
      }
      if ($normalizedText.IndexOf('outside the repo', [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
        $score += 3
      }
      if ($normalizedText.IndexOf('command', [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
        $score += 1
      }
      if ($normalizedText.IndexOf('run', [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
        $score += 1
      }
    }

    return $score
  }

  function Get-ApprovalMatches($rootElement, $searchProfile) {
    $allElements = $rootElement.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition
    )

    $matchingElements = @()
    foreach ($element in $allElements) {
      $texts = Get-ElementSearchTexts $element
      $matchScore = Get-TextMatchScore $texts $searchProfile
      if ($matchScore -lt 4) {
        continue
      }

      $matchingElements += [PSCustomObject]@{
        Element = $element
        Name = ($texts | Select-Object -First 1)
        ControlType = Get-ControlTypeName $element
        Score = $matchScore
      }
    }

    $matchingElements = $matchingElements | Sort-Object Score -Descending

    if (-not $matchingElements -or $matchingElements.Count -eq 0) {
      foreach ($element in $allElements) {
        $controlType = Get-ControlTypeName $element
        if ($controlType -notin @('ControlType.Pane', 'ControlType.Group', 'ControlType.Custom', 'ControlType.Window')) {
          continue
        }

        $texts = Get-ContainerAggregateTexts $element
        $matchScore = Get-TextMatchScore $texts $searchProfile
        if ($matchScore -lt 6) {
          continue
        }

        $matchingElements += [PSCustomObject]@{
          Element = $element
          Name = ($texts | Select-Object -First 1)
          ControlType = $controlType
          Score = $matchScore
        }
      }

      $matchingElements = $matchingElements | Sort-Object Score -Descending
    }

    $approvalLikeContainers = @()
    foreach ($element in $allElements) {
      $controlType = Get-ControlTypeName $element
      if ($controlType -notin @('ControlType.Pane', 'ControlType.Group', 'ControlType.Custom', 'ControlType.Window')) {
        continue
      }

      $texts = Get-ContainerAggregateTexts $element
      $heuristicScore = Get-ApprovalContainerHeuristicScore $texts
      $hasNumberedChoices = Test-HasNumberedApprovalChoices $texts
      $approveButton = Find-ActionButton $element 'approve'
      $denyButton = Find-ActionButton $element 'deny'
      if ((-not $hasNumberedChoices) -and ((-not $approveButton) -or (-not $denyButton))) {
        continue
      }
      if ($heuristicScore -lt 5) {
        continue
      }

      $approvalLikeContainers += [PSCustomObject]@{
        Element = $element
        Name = ($texts | Select-Object -First 1)
        ControlType = $controlType
        Score = $heuristicScore
      }
    }

    $approvalLikeContainers = $approvalLikeContainers | Sort-Object Score -Descending
    if ((-not $matchingElements -or $matchingElements.Count -eq 0) -and $approvalLikeContainers.Count -eq 1) {
      $matchingElements = $approvalLikeContainers
    }

    return [PSCustomObject]@{
      AllElements = $allElements
      MatchingElements = $matchingElements
      ApprovalLikeContainers = $approvalLikeContainers
    }
  }

  function Wait-ForApprovalMatches($windowHandle, $searchProfile, [int]$timeoutMs, [int]$pollMs) {
    $deadline = [DateTime]::UtcNow.AddMilliseconds($timeoutMs)

    while ($true) {
      $rootElement = [System.Windows.Automation.AutomationElement]::FromHandle($windowHandle)
      if (-not $rootElement) {
        throw 'Could not reattach to the Codex desktop window after switching threads.'
      }

      $result = Get-ApprovalMatches $rootElement $searchProfile
      if ($result.MatchingElements -and $result.MatchingElements.Count -gt 0) {
        return [PSCustomObject]@{
          Root = $rootElement
          AllElements = $result.AllElements
          MatchingElements = $result.MatchingElements
          ApprovalLikeContainers = $result.ApprovalLikeContainers
        }
      }

      if ([DateTime]::UtcNow -ge $deadline) {
        return [PSCustomObject]@{
          Root = $rootElement
          AllElements = $result.AllElements
          MatchingElements = $result.MatchingElements
          ApprovalLikeContainers = $result.ApprovalLikeContainers
        }
      }

      Start-Sleep -Milliseconds $pollMs
    }
  }

  function Test-HasNumberedApprovalChoices($texts) {
    if (-not $texts -or $texts.Count -eq 0) {
      return $false
    }

    $sawApproveChoice = $false
    $sawDenyChoice = $false

    foreach ($text in $texts) {
      $normalizedText = Normalize-Text $text
      if ([string]::IsNullOrWhiteSpace($normalizedText)) {
        continue
      }

      if (
        ($normalizedText -match '(^|\\s)1[\\.\\u3002\\u3001]?\\s*(Yes|Approve|Allow|\\u662F)') -or
        ($normalizedText -match '\\bApprove once\\b') -or
        ($normalizedText -match '\\bApprove\\b')
      ) {
        $sawApproveChoice = $true
      }

      if (
        ($normalizedText -match '(^|\\s)3[\\.\\u3002\\u3001]?\\s*(No|Deny|\\u5426)') -or
        ($normalizedText -match '\\bDeny\\b') -or
        ($normalizedText -match '\\bNo\\b')
      ) {
        $sawDenyChoice = $true
      }
    }

    return ($sawApproveChoice -and $sawDenyChoice)
  }

  function Get-ActionPatterns([string]$action) {
    if ($action -eq 'deny') {
      return @(
        '^&?No(?:\\(&[A-Z]\\))?$',
        '^&?Deny$',
        '^&?\\u5426(?:\\(&[A-Z]\\))?(?:$|[\\uFF0C,].*)',
        '^&?3[\\.\\u3002\\u3001]?\\s*\\u5426(?:\\(&[A-Z]\\))?(?:$|[\\uFF0C,].*)'
      )
    }

    return @(
      '^&?Yes(?:\\(&[A-Z]\\))?$',
      '^&?Approve once$',
      '^&?Approve$',
      '^&?\\u662F(?:\\(&[A-Z]\\))?$',
      '^&?1[\\.\\u3002\\u3001]?\\s*\\u662F(?:\\(&[A-Z]\\))?(?:$|[\\uFF0C,].*)'
    )
  }

  function Find-ActionButton($container, [string]$action) {
    $patterns = Get-ActionPatterns $action
    $buttons = $container.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition
    )

    $buttonCandidates = @()
    foreach ($button in $buttons) {
      if ((Get-ControlTypeName $button) -ne 'ControlType.Button') {
        continue
      }

      $name = Get-ElementName $button
      if ([string]::IsNullOrWhiteSpace($name)) {
        continue
      }

      $buttonCandidates += [PSCustomObject]@{
        Element = $button
        Name = $name
      }
    }

    foreach ($pattern in $patterns) {
      $exact = $buttonCandidates | Where-Object { $_.Name -match $pattern } | Select-Object -First 1
      if ($exact) {
        return $exact
      }
    }

    return $null
  }

  function Find-UniqueWindowActionButton($rootElement, [string]$action) {
    $patterns = Get-ActionPatterns $action
    $buttons = $rootElement.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition
    )

    $buttonCandidates = @()
    foreach ($button in $buttons) {
      if ((Get-ControlTypeName $button) -ne 'ControlType.Button') {
        continue
      }

      $name = Get-ElementName $button
      if ([string]::IsNullOrWhiteSpace($name)) {
        continue
      }

      foreach ($pattern in $patterns) {
        if ($name -match $pattern) {
          try {
            $runtimeKey = [string]::Join('-', $button.GetRuntimeId())
          } catch {
            $runtimeKey = $name
          }

          $buttonCandidates += [PSCustomObject]@{
            Element = $button
            Name = $name
            RuntimeKey = $runtimeKey
          }
          break
        }
      }
    }

    if (-not $buttonCandidates -or $buttonCandidates.Count -eq 0) {
      return $null
    }

    $uniqueCandidates = @()
    $seenRuntimeKeys = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($candidate in $buttonCandidates) {
      if ($seenRuntimeKeys.Add($candidate.RuntimeKey)) {
        $uniqueCandidates += $candidate
      }
    }

    if ($uniqueCandidates.Count -ne 1) {
      return $null
    }

    return $uniqueCandidates[0]
  }

  function Find-ClickableAncestor($element) {
    if (-not $element) {
      return $null
    }

    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $current = $element
    $depth = 0

    while ($null -ne $current -and $depth -lt 6) {
      $controlType = Get-ControlTypeName $current
      if ($controlType -in @(
        'ControlType.ListItem',
        'ControlType.TreeItem',
        'ControlType.DataItem',
        'ControlType.Button',
        'ControlType.Hyperlink',
        'ControlType.TabItem',
        'ControlType.Custom'
      )) {
        $rect = Get-ElementRectangle $current
        if ($rect -and $rect.Width -gt 0 -and $rect.Height -gt 0) {
          return $current
        }
      }

      $current = $walker.GetParent($current)
      $depth += 1
    }

    return $null
  }

  function Invoke-UiElement($windowHandle, $element, [string]$elementName) {
    if (-not $element) {
      return [PSCustomObject]@{
        ok = $false
        error = 'Navigation element is missing.'
        elementName = $elementName
      }
    }

    try {
      $selectionItemPattern = $element.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
      if ($selectionItemPattern) {
        $selectionItemPattern.Select()
        return [PSCustomObject]@{
          ok = $true
          method = 'SelectionItemPattern'
          elementName = $elementName
        }
      }
    } catch {
    }

    try {
      $invokePattern = $element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
      if ($invokePattern) {
        $invokePattern.Invoke()
        return [PSCustomObject]@{
          ok = $true
          method = 'InvokePattern'
          elementName = $elementName
        }
      }
    } catch {
    }

    try {
      $legacyPattern = $element.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern)
      if ($legacyPattern) {
        $legacyPattern.DoDefaultAction()
        return [PSCustomObject]@{
          ok = $true
          method = 'LegacyIAccessiblePattern'
          elementName = $elementName
        }
      }
    } catch {
    }

    try {
      $rect = Get-ElementRectangle $element
      if (-not $rect -or $rect.Width -le 0 -or $rect.Height -le 0) {
        throw 'Element does not expose a clickable bounding rectangle.'
      }

      [void][MobileCodexNativeMethods]::ShowWindow($windowHandle, 9)
      [void][MobileCodexNativeMethods]::SetForegroundWindow($windowHandle)
      Start-Sleep -Milliseconds 120
      $clickX = [int]($rect.X + ($rect.Width / 2))
      $clickY = [int]($rect.Y + ($rect.Height / 2))
      [void][MobileCodexNativeMethods]::SetCursorPos($clickX, $clickY)
      [MobileCodexNativeMethods]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 50
      [MobileCodexNativeMethods]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
      return [PSCustomObject]@{
        ok = $true
        method = 'MouseClick'
        elementName = $elementName
      }
    } catch {
      return [PSCustomObject]@{
        ok = $false
        error = $_.Exception.Message
        elementName = $elementName
      }
    }
  }

  function Find-SessionNavigationCandidate($rootElement, $request) {
    $searchProfile = Get-SessionNavigationSearchProfile $request
    if (-not $searchProfile) {
      return $null
    }

    $rootRect = Get-ElementRectangle $rootElement
    if (-not $rootRect -or $rootRect.Width -le 0 -or $rootRect.Height -le 0) {
      return $null
    }

    $sidebarBoundaryX = $rootRect.X + ($rootRect.Width * 0.45)
    $elements = $rootElement.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition
    )

    $candidates = @()
    $seenRuntimeKeys = New-Object 'System.Collections.Generic.HashSet[string]'

    foreach ($element in $elements) {
      $rect = Get-ElementRectangle $element
      if (-not $rect -or $rect.Width -le 0 -or $rect.Height -le 0) {
        continue
      }

      if ($rect.X -gt $sidebarBoundaryX) {
        continue
      }

      $texts = Get-ElementSearchTexts $element
      $score = Get-TextMatchScore $texts $searchProfile
      if ($score -lt 5) {
        continue
      }

      if ((Get-ApprovalContainerHeuristicScore $texts) -ge 4) {
        continue
      }

      $clickTarget = Find-ClickableAncestor $element
      if (-not $clickTarget) {
        continue
      }

      try {
        $runtimeKey = [string]::Join('-', $clickTarget.GetRuntimeId())
      } catch {
        $runtimeKey = [guid]::NewGuid().ToString()
      }

      if (-not $seenRuntimeKeys.Add($runtimeKey)) {
        continue
      }

      $targetName = Get-ElementName $clickTarget
      $targetControlType = Get-ControlTypeName $clickTarget
      $candidateScore = $score + (Get-ClickableControlTypeWeight $targetControlType)

      $candidates += [PSCustomObject]@{
        Element = $clickTarget
        Name = $(if ([string]::IsNullOrWhiteSpace($targetName)) { ($texts | Select-Object -First 1) } else { $targetName })
        MatchText = ($texts | Select-Object -First 1)
        Score = $candidateScore
      }
    }

    if (-not $candidates -or $candidates.Count -eq 0) {
      return $null
    }

    $orderedCandidates = $candidates | Sort-Object Score -Descending
    $topCandidate = $orderedCandidates | Select-Object -First 1
    $secondCandidate = $orderedCandidates | Select-Object -Skip 1 -First 1

    if (-not $topCandidate -or $topCandidate.Score -lt 7) {
      return $null
    }

    if ($secondCandidate -and ($topCandidate.Score - $secondCandidate.Score) -lt 2) {
      return $null
    }

    return $topCandidate
  }

  function Find-WorkflowSessionListCandidate($rootElement, $request) {
    $sessionId = Normalize-Text (Get-TrimmedString $request.sessionId)
    if ([string]::IsNullOrWhiteSpace($sessionId)) {
      return $null
    }

    $sessionList = Find-LocatorControl $rootElement 'workflow.recent_sessions_list'
    if (-not $sessionList) {
      return $null
    }

    $items = $sessionList.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition
    )

    $candidates = @()
    foreach ($item in $items) {
      $controlType = Get-ControlTypeName $item
      if ($controlType -notin @('ControlType.ListItem', 'ControlType.DataItem', 'ControlType.TreeItem', 'ControlType.Custom')) {
        continue
      }

      $itemText = Read-CombinedElementText $item
      if ([string]::IsNullOrWhiteSpace($itemText)) {
        continue
      }

      if ($itemText.IndexOf($sessionId, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) {
        continue
      }

      $score = 3
      if ($itemText -match ("(?im)^" + [regex]::Escape($sessionId) + "(?:\\s|$)")) {
        $score += 6
      }

      $clickTarget = Find-ClickableAncestor $item
      if (-not $clickTarget) {
        continue
      }

      $candidates += [PSCustomObject]@{
        Element = $clickTarget
        Name = $itemText
        Score = $score + (Get-ClickableControlTypeWeight (Get-ControlTypeName $clickTarget))
      }
    }

    if (-not $candidates -or $candidates.Count -eq 0) {
      return $null
    }

    return ($candidates | Sort-Object Score -Descending | Select-Object -First 1)
  }

  function Invoke-ApprovalButton($windowHandle, $buttonCandidate) {
    $button = $buttonCandidate.Element

    try {
      $invokePattern = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
      if ($invokePattern) {
        $invokePattern.Invoke()
        return [PSCustomObject]@{
          ok = $true
          method = 'InvokePattern'
          buttonName = $buttonCandidate.Name
        }
      }
    } catch {
    }

    try {
      $legacyPattern = $button.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern)
      if ($legacyPattern) {
        $legacyPattern.DoDefaultAction()
        return [PSCustomObject]@{
          ok = $true
          method = 'LegacyIAccessiblePattern'
          buttonName = $buttonCandidate.Name
        }
      }
    } catch {
    }

    try {
      $rect = $button.Current.BoundingRectangle
      if ($rect.Width -le 0 -or $rect.Height -le 0) {
        throw 'Button does not expose a clickable bounding rectangle.'
      }

      [void][MobileCodexNativeMethods]::ShowWindow($windowHandle, 9)
      [void][MobileCodexNativeMethods]::SetForegroundWindow($windowHandle)
      Start-Sleep -Milliseconds 120
      $clickX = [int]($rect.X + ($rect.Width / 2))
      $clickY = [int]($rect.Y + ($rect.Height / 2))
      [void][MobileCodexNativeMethods]::SetCursorPos($clickX, $clickY)
      [MobileCodexNativeMethods]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 50
      [MobileCodexNativeMethods]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
      return [PSCustomObject]@{
        ok = $true
        method = 'MouseClick'
        buttonName = $buttonCandidate.Name
      }
    } catch {
      return [PSCustomObject]@{
        ok = $false
        error = $_.Exception.Message
        buttonName = $buttonCandidate.Name
      }
    }
  }

  function Invoke-ApprovalShortcut($processId, $windowHandle, [string]$action, [string]$matchedText) {
    $shortcutKey = switch ($action) {
      'deny' { '3' }
      default { '1' }
    }

    try {
      $shell = New-Object -ComObject WScript.Shell
      [void][MobileCodexNativeMethods]::ShowWindow($windowHandle, 9)
      [void][MobileCodexNativeMethods]::SetForegroundWindow($windowHandle)
      Start-Sleep -Milliseconds 180

      if (-not $shell.AppActivate([int]$processId)) {
        throw 'Could not activate the Codex desktop window for keyboard approval.'
      }

      Start-Sleep -Milliseconds 180
      $shell.SendKeys($shortcutKey)
      Start-Sleep -Milliseconds 120
      $shell.SendKeys('{ENTER}')
      return [PSCustomObject]@{
        ok = $true
        method = 'KeyboardShortcut'
        buttonName = $shortcutKey
        matchedText = $matchedText
      }
    } catch {
      return [PSCustomObject]@{
        ok = $false
        error = $_.Exception.Message
        buttonName = $shortcutKey
        matchedText = $matchedText
      }
    }
  }

  $codexProcess = Get-OpenCodexProcess
  if (-not $codexProcess) {
    throw 'No visible Codex desktop window is open.'
  }

  $approvalProcess = $codexProcess
  $approvalHost = 'codex'
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($approvalProcess.MainWindowHandle)
  if (-not $root) {
    throw 'Could not attach to the Codex desktop window.'
  }

  $allowShortcutFallback = $payload.allowShortcutFallback -eq $true
  $allowThreadSwitch = $payload.allowThreadSwitch -eq $true
  $threadSwitchResult = $null
  $threadSwitchAttempted = $false
  $usedWorkflowSessionSwitch = $false
  $threadSwitchHostProcess = $approvalProcess

  if ($allowThreadSwitch) {
    $previousMainCta = ''
    $previousActionDetail = ''
    $sessionNavigationCandidate = $null

    $workflowProcess = Get-OpenWorkflowShellProcess
    if ($workflowProcess) {
      try {
        $workflowRoot = [System.Windows.Automation.AutomationElement]::FromHandle($workflowProcess.MainWindowHandle)
        if ($workflowRoot) {
          $workflowCandidate = Find-WorkflowSessionListCandidate $workflowRoot $payload
          if ($workflowCandidate) {
            $sessionNavigationCandidate = $workflowCandidate
            $usedWorkflowSessionSwitch = $true
            $threadSwitchHostProcess = $workflowProcess
            $previousMainCta = Read-CombinedElementText (Find-LocatorControl $workflowRoot 'workflow.main_cta')
            $previousActionDetail = Read-CombinedElementText (Find-LocatorControl $workflowRoot 'workflow.action_detail')
          }
        }
      } catch {
      }
    }

    if (-not $sessionNavigationCandidate) {
      $previousMainCta = Read-CombinedElementText (Find-LocatorControl $root 'workflow.main_cta')
      $previousActionDetail = Read-CombinedElementText (Find-LocatorControl $root 'workflow.action_detail')
      $sessionNavigationCandidate = Find-WorkflowSessionListCandidate $root $payload
      if ($sessionNavigationCandidate) {
        $usedWorkflowSessionSwitch = $true
      }
    }

    if (-not $sessionNavigationCandidate) {
      $sessionNavigationCandidate = Find-SessionNavigationCandidate $root $payload
      $threadSwitchHostProcess = $approvalProcess
    }

    if ($sessionNavigationCandidate) {
      $threadSwitchAttempted = $true
      $threadSwitchResult = Invoke-UiElement $threadSwitchHostProcess.MainWindowHandle $sessionNavigationCandidate.Element $sessionNavigationCandidate.Name
      if ($threadSwitchResult.ok) {
        $activated = $false
        for ($attempt = 0; $attempt -lt 12; $attempt++) {
          Start-Sleep -Milliseconds 250
          $root = [System.Windows.Automation.AutomationElement]::FromHandle($threadSwitchHostProcess.MainWindowHandle)
          if (Test-WorkflowSessionActivated $root $payload.sessionId $previousMainCta $previousActionDetail) {
            $activated = $true
            break
          }
        }

        if (-not $activated) {
          Start-Sleep -Milliseconds 900
          $root = [System.Windows.Automation.AutomationElement]::FromHandle($threadSwitchHostProcess.MainWindowHandle)
        }

        if ($usedWorkflowSessionSwitch) {
          Start-Sleep -Milliseconds 400
          $approvalProcess = $codexProcess
          $approvalHost = 'codex'
          $root = [System.Windows.Automation.AutomationElement]::FromHandle($approvalProcess.MainWindowHandle)
        }
      }
    }
  }

  $searchProfile = Get-SearchTerms $payload
  if (
    (-not $searchProfile) -or
    (($searchProfile.StrictTerms.Count + $searchProfile.SoftTerms.Count + $searchProfile.Tokens.Count) -eq 0)
  ) {
    throw 'Approval request is missing searchable text.'
  }

  $waitTimeoutMs = $(if ($threadSwitchResult -and $threadSwitchResult.ok) { 6500 } else { 1200 })
  $matchSnapshot = Wait-ForApprovalMatches $approvalProcess.MainWindowHandle $searchProfile $waitTimeoutMs 300
  $root = $matchSnapshot.Root
  $allElements = $matchSnapshot.AllElements
  $matchingElements = $matchSnapshot.MatchingElements
  $approvalLikeContainers = $matchSnapshot.ApprovalLikeContainers

  if (-not $matchingElements -or $matchingElements.Count -eq 0) {
    $windowActionButton = Find-UniqueWindowActionButton $root $payload.action
    if ($windowActionButton -and (-not $threadSwitchAttempted)) {
      $windowInvokeResult = Invoke-ApprovalButton $approvalProcess.MainWindowHandle $windowActionButton
      if ($windowInvokeResult.ok) {
        [pscustomobject]@{
          ok = $true
          action = $payload.action
          requestId = $payload.requestId
          processId = $approvalProcess.Id
          processName = $approvalProcess.ProcessName
          hostWindowTitle = $approvalProcess.MainWindowTitle
          hostKind = $approvalHost
          matchedText = 'window-action-fallback'
          buttonName = $windowInvokeResult.buttonName
          method = $windowInvokeResult.method
          threadSwitchAttempted = $threadSwitchAttempted
          switchedThread = $(if ($threadSwitchResult -and $threadSwitchResult.ok) { $true } else { $false })
          threadSwitchHostProcess = $(if ($threadSwitchHostProcess) { $threadSwitchHostProcess.ProcessName } else { $null })
          threadSwitchMethod = $(if ($threadSwitchResult) { $threadSwitchResult.method } else { $null })
          threadSwitchTarget = $(if ($threadSwitchResult) { $threadSwitchResult.elementName } else { $null })
        } | ConvertTo-Json -Compress
        return
      }
    }

    if ($allowShortcutFallback -and (-not $threadSwitchAttempted) -and $approvalLikeContainers.Count -eq 1) {
      $shortcutResult = Invoke-ApprovalShortcut $approvalProcess.Id $approvalProcess.MainWindowHandle $payload.action 'keyboard-shortcut-fallback'
      if ($shortcutResult.ok) {
        [pscustomobject]@{
          ok = $true
          action = $payload.action
          requestId = $payload.requestId
          processId = $approvalProcess.Id
          processName = $approvalProcess.ProcessName
          hostWindowTitle = $approvalProcess.MainWindowTitle
          hostKind = $approvalHost
          matchedText = $shortcutResult.matchedText
          buttonName = $shortcutResult.buttonName
          method = $shortcutResult.method
          threadSwitchAttempted = $threadSwitchAttempted
          switchedThread = $(if ($threadSwitchResult -and $threadSwitchResult.ok) { $true } else { $false })
          threadSwitchHostProcess = $(if ($threadSwitchHostProcess) { $threadSwitchHostProcess.ProcessName } else { $null })
          threadSwitchMethod = $(if ($threadSwitchResult) { $threadSwitchResult.method } else { $null })
          threadSwitchTarget = $(if ($threadSwitchResult) { $threadSwitchResult.elementName } else { $null })
        } | ConvertTo-Json -Compress
        return
      }
    }

    if ($threadSwitchAttempted -and $threadSwitchResult -and (-not $threadSwitchResult.ok)) {
      throw "Attempted to switch to the target thread, but the desktop navigation action failed: $($threadSwitchResult.error)"
    }

    if ($threadSwitchAttempted -and $threadSwitchResult -and $threadSwitchResult.ok) {
      throw "Switched to thread '$($threadSwitchResult.elementName)', but could not confirm the target desktop approval prompt."
    }

    throw 'Could not find the matching desktop approval text in the Codex window.'
  }

  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $visitedAncestors = New-Object 'System.Collections.Generic.HashSet[string]'
  $clickedResult = $null
  $matchedElementName = $null
  $sawApprovalLikePrompt = $false

  foreach ($match in $matchingElements) {
    $current = $match.Element
    $sawApprovalLikePrompt = $true

    while ($null -ne $current) {
      try {
        $runtimeId = $current.GetRuntimeId()
        $runtimeKey = [string]::Join('-', $runtimeId)
      } catch {
        $runtimeKey = [guid]::NewGuid().ToString()
      }

      if (-not $visitedAncestors.Add($runtimeKey)) {
        $current = $walker.GetParent($current)
        continue
      }

      $buttonCandidate = Find-ActionButton $current $payload.action
      if ($buttonCandidate) {
        $invokeResult = Invoke-ApprovalButton $approvalProcess.MainWindowHandle $buttonCandidate
        if ($invokeResult.ok) {
          $clickedResult = $invokeResult
          $matchedElementName = $match.Name
          break
        }
      }

      $current = $walker.GetParent($current)
    }

    if ($clickedResult) {
      break
    }
  }

  if (-not $clickedResult) {
    $windowActionButton = Find-UniqueWindowActionButton $root $payload.action
    if ($windowActionButton -and (-not $threadSwitchAttempted)) {
      $windowInvokeResult = Invoke-ApprovalButton $codexProcess.MainWindowHandle $windowActionButton
      if ($windowInvokeResult.ok) {
        $clickedResult = $windowInvokeResult
        $matchedElementName = 'window-action-fallback'
      }
    }
  }

  if ((-not $clickedResult) -and ($sawApprovalLikePrompt -or ($allowShortcutFallback -and (-not $threadSwitchAttempted)))) {
    $shortcutResult = Invoke-ApprovalShortcut $approvalProcess.Id $approvalProcess.MainWindowHandle $payload.action $matchedElementName
    if ($shortcutResult.ok) {
      $clickedResult = $shortcutResult
      if (-not $matchedElementName) {
        $matchedElementName = $shortcutResult.matchedText
      }
    }
  }

  if (-not $clickedResult) {
    throw 'Found the desktop approval prompt, but could not find a safe action button to invoke.'
  }

  [pscustomobject]@{
    ok = $true
    action = $payload.action
    requestId = $payload.requestId
    processId = $approvalProcess.Id
    processName = $approvalProcess.ProcessName
    hostWindowTitle = $approvalProcess.MainWindowTitle
    hostKind = $approvalHost
    matchedText = $matchedElementName
    buttonName = $clickedResult.buttonName
    method = $clickedResult.method
    threadSwitchAttempted = $threadSwitchAttempted
    switchedThread = $(if ($threadSwitchResult -and $threadSwitchResult.ok) { $true } else { $false })
    threadSwitchHostProcess = $(if ($threadSwitchHostProcess) { $threadSwitchHostProcess.ProcessName } else { $null })
    threadSwitchMethod = $(if ($threadSwitchResult) { $threadSwitchResult.method } else { $null })
    threadSwitchTarget = $(if ($threadSwitchResult) { $threadSwitchResult.elementName } else { $null })
  } | ConvertTo-Json -Compress
} catch {
  [pscustomobject]@{
    ok = $false
    code = 'desktop_ui_automation_runtime'
    message = $_.Exception.Message
    details = (($_ | Out-String).Trim())
  } | ConvertTo-Json -Compress
}
`;

  return script;
}

async function writePowerShellHelperScript(payload) {
  const scriptPath = path.join(os.tmpdir(), `mobile-codex-desktop-approval-helper-${process.pid}.ps1`);
  await fs.writeFile(scriptPath, buildPowerShellScript(payload), 'utf8');
  return scriptPath;
}

export function isDesktopApprovalUiAutomationEnabled() {
  return UI_AUTOMATION_ENABLED;
}

export async function resolveDesktopApprovalViaUiAutomation(approval, action) {
  if (!UI_AUTOMATION_ENABLED) {
    return {
      ok: false,
      code: 'desktop_ui_automation_disabled',
      message: 'Desktop UI automation is not enabled on this platform.',
    };
  }

  const scriptPath = await writePowerShellHelperScript(buildPayload(approval, action));

  try {
    const { stdout, stderr } = await execFileAsync(
      POWERSHELL_PATH,
      [
        '-OutputFormat',
        'Text',
        '-NoProfile',
        '-NonInteractive',
        '-Sta',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
      ],
      {
        windowsHide: true,
        timeout: POWERSHELL_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
      },
    );

    const rawOutput = normalizeOutput(stdout);
    const parsedOutput = tryParseJsonOutput(rawOutput);
    if (parsedOutput) {
      return parsedOutput;
    }

    if (!rawOutput) {
      return {
        ok: false,
        code: 'desktop_ui_automation_empty_output',
        message: 'Desktop UI automation produced no output.',
        stderr: normalizeOutput(stderr) || null,
      };
    }

    return {
      ok: false,
      code: 'desktop_ui_automation_invalid_json',
      message: 'Desktop UI automation returned invalid output.',
      stdout: rawOutput,
      stderr: normalizeOutput(stderr) || null,
    };
  } catch (error) {
    const parsedOutput = tryParseJsonOutput(error?.stdout);
    if (parsedOutput) {
      return parsedOutput;
    }

    return {
      ok: false,
      code: 'desktop_ui_automation_failed',
      message: getUiAutomationFailureMessage(error),
      stdout: normalizeOutput(error?.stdout) || null,
      stderr: normalizeOutput(error?.stderr) || null,
    };
  } finally {
    await fs.unlink(scriptPath).catch(() => {});
  }
}
