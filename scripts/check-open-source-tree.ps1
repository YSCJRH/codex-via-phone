$workspace = Split-Path -Parent $PSScriptRoot
$workspaceRoot = (Resolve-Path -LiteralPath $workspace).Path
$errors = New-Object System.Collections.Generic.List[string]

$blockedDirNames = @(
  'vendor',
  'node_modules',
  'dist',
  'build',
  '.runtime',
  'tmp',
  '__pycache__',
  '.npm-cache',
  'private-docs',
  'logs',
  'diagnostics',
  'screenshots',
  'images'
)

$ignoredDirNames = @(
  '.git'
)

$blockedExtensions = @(
  '.db',
  '.db-wal',
  '.db-shm',
  '.sqlite',
  '.sqlite3',
  '.log',
  '.jsonl',
  '.har',
  '.pcap',
  '.exe',
  '.pyc',
  '.tar',
  '.gz',
  '.tgz',
  '.zip',
  '.7z',
  '.rar',
  '.pem',
  '.crt',
  '.key',
  '.p12',
  '.pfx'
)

$blockedFileNames = @(
  '.env',
  'known_hosts'
)

$blockedFileNamePatterns = @(
  '^\.env\.(?!example$).+$',
  '^known_hosts\..+$'
)

$imageExtensions = @(
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.tiff',
  '.svg'
)

$allowedImageRelativePaths = @(
  'docs/assets/mobile-codex-control-console.png',
  'docs/assets/readme/mobile-hero-collage.png',
  'docs/assets/readme/mobile-home-real-device.png',
  'docs/assets/readme/mobile-chat-real-device.png',
  'docs/assets/readme/mobile-approval-real-device.png'
)

$searchableExtensions = @(
  '.md',
  '.txt',
  '.ps1',
  '.cmd',
  '.py',
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.json',
  '.yml',
  '.yaml',
  '.example',
  '.conf'
)

$sensitivePatterns = @(
  @{ name = 'private-key-header'; pattern = 'BEGIN PRIVATE KEY' },
  @{ name = 'openssh-private-key-header'; pattern = 'BEGIN OPENSSH PRIVATE KEY' },
  @{ name = 'rsa-private-key-header'; pattern = 'BEGIN RSA PRIVATE KEY' },
  @{ name = 'ec-private-key-header'; pattern = 'BEGIN EC PRIVATE KEY' },
  @{ name = 'windows-user-path'; pattern = '[A-Za-z]:\\Users\\[^\\/\r\n]+' },
  @{ name = 'tailnet-domain'; pattern = '\b[a-z0-9-]+\.[a-z0-9-]+\.ts\.net\b' },
  @{ name = 'tailnet-ip'; pattern = '\b100\.\d{1,3}\.\d{1,3}\.\d{1,3}\b' },
  @{ name = 'private-ip-10'; pattern = '\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b' },
  @{ name = 'private-ip-172'; pattern = '\b172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}\b' },
  @{ name = 'private-ip-192'; pattern = '\b192\.168\.\d{1,3}\.\d{1,3}\b' },
  @{ name = 'request-token-value'; pattern = '(?i)"request[_-]?token"\s*:\s*"[^"]{6,}"' },
  @{ name = 'session-id-value'; pattern = '(?i)"session[_-]?id"\s*:\s*"[^"]{6,}"' },
  @{ name = 'approval-trace-value'; pattern = '(?i)"approval[_-]?(trace|evidence|session)"\s*:\s*"[^"]{3,}"' }
)

function Add-OpenSourceTreeError {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Message
  )

  if (-not $errors.Contains($Message)) {
    $errors.Add($Message)
  }
}

function Get-NormalizedRelativePath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $candidate = $Path
  try {
    if (Test-Path -LiteralPath $Path) {
      $candidate = (Resolve-Path -LiteralPath $Path).Path
    }
  } catch {
  }

  if ($candidate.StartsWith($workspaceRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    $relative = $candidate.Substring($workspaceRoot.Length).TrimStart('\', '/')
    if (-not $relative) {
      return '.'
    }

    return ($relative -replace '\\', '/')
  }

  return ($candidate -replace '\\', '/')
}

function Test-AllowedImagePath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RelativePath
  )

  return $allowedImageRelativePaths -contains $RelativePath
}

function Get-ReviewFiles {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Root
  )

  $files = New-Object System.Collections.Generic.List[System.IO.FileInfo]
  $pending = New-Object System.Collections.Generic.Stack[System.IO.DirectoryInfo]
  $pending.Push((Get-Item -LiteralPath $Root))

  while ($pending.Count -gt 0) {
    $current = $pending.Pop()

    foreach ($entry in Get-ChildItem -LiteralPath $current.FullName -Force -ErrorAction SilentlyContinue) {
      $relativePath = Get-NormalizedRelativePath -Path $entry.FullName

      if ($entry.PSIsContainer) {
        if ($ignoredDirNames -contains $entry.Name) {
          continue
        }

        if ($blockedDirNames -contains $entry.Name) {
          Add-OpenSourceTreeError "Blocked directory present: $relativePath"
          continue
        }

        $pending.Push($entry)
        continue
      }

      $files.Add($entry)
    }
  }

  return $files
}

$reviewFiles = Get-ReviewFiles -Root $workspace

foreach ($file in $reviewFiles) {
  $relativePath = Get-NormalizedRelativePath -Path $file.FullName
  $fileName = $file.Name
  $extension = $file.Extension.ToLowerInvariant()

  if ($blockedExtensions -contains $extension) {
    Add-OpenSourceTreeError "Blocked file present: $relativePath"
    continue
  }

  if ($blockedFileNames -contains $fileName) {
    Add-OpenSourceTreeError "Blocked file present: $relativePath"
    continue
  }

  if (@($blockedFileNamePatterns | Where-Object { $fileName -match $_ }).Count -gt 0) {
    Add-OpenSourceTreeError "Blocked file present: $relativePath"
    continue
  }

  if (($imageExtensions -contains $extension) -and (-not (Test-AllowedImagePath -RelativePath $relativePath))) {
    Add-OpenSourceTreeError "Blocked image file present: $relativePath"
  }
}

$selfPath = (Resolve-Path -LiteralPath $PSCommandPath).Path
$textFiles = $reviewFiles | Where-Object {
  $_.FullName -ne $selfPath -and
  $searchableExtensions -contains $_.Extension.ToLowerInvariant()
}

foreach ($rule in $sensitivePatterns) {
  $hits = $textFiles | Select-String -Pattern $rule.pattern
  foreach ($hit in $hits) {
    $hitRelativePath = Get-NormalizedRelativePath -Path $hit.Path
    Add-OpenSourceTreeError ("Sensitive text pattern ({0}) found in {1}:{2}" -f $rule.name, $hitRelativePath, $hit.LineNumber)
  }
}

if ($errors.Count -gt 0) {
  $errors | ForEach-Object { Write-Error $_ }
  exit 1
}

Write-Output 'Open-source tree check passed.'
