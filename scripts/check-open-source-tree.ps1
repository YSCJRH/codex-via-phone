$workspace = Split-Path -Parent $PSScriptRoot
$errors = @()

$blockedDirs = @('vendor', 'node_modules', 'dist', 'build', '.runtime', 'tmp', '__pycache__', '.npm-cache', 'private-docs')
foreach ($dir in $blockedDirs) {
  if (Test-Path (Join-Path $workspace $dir)) {
    $errors += "Blocked directory present: $dir"
  }
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
      if ($entry.PSIsContainer) {
        if ($blockedDirs -contains $entry.Name) {
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

$blockedExtensions = @(
  '.db', '.log', '.sqlite', '.sqlite3', '.exe', '.pyc',
  '.jsonl', '.tar', '.gz', '.tgz', '.zip', '.7z', '.rar', '.pem', '.crt', '.key', '.p12', '.pfx'
)
$blockedFileNames = @('.env', 'known_hosts')
$blockedFileNamePatterns = @(
  '^known_hosts\..+$'
)

$reviewFiles = Get-ReviewFiles -Root $workspace

$blockedFiles = $reviewFiles | Where-Object {
  $fileName = $_.Name
  $_.FullName -notmatch '\\upstream-overrides\\' -and (
    $blockedExtensions -contains $_.Extension.ToLowerInvariant() -or
    $blockedFileNames -contains $fileName -or
    @($blockedFileNamePatterns | Where-Object { $fileName -match $_ }).Count -gt 0
  )
}
foreach ($file in $blockedFiles) {
  $errors += "Blocked file present: $($file.FullName)"
}

$selfPath = Join-Path $workspace 'scripts\check-open-source-tree.ps1'
$searchableExtensions = @('.md', '.txt', '.ps1', '.cmd', '.py', '.js', '.ts', '.tsx', '.jsx', '.json', '.example', '.conf')
$sensitivePatterns = @(
  'BEGIN PRIVATE KEY',
  'BEGIN OPENSSH PRIVATE KEY',
  'BEGIN RSA PRIVATE KEY',
  'BEGIN EC PRIVATE KEY',
  '[A-Za-z]:\\Users\\[^\\/\r\n]+',
  '\b[a-z0-9-]+\.[a-z0-9-]+\.ts\.net\b'
)
$textHits = $reviewFiles | Where-Object {
  $_.FullName -ne $selfPath -and
  $searchableExtensions -contains $_.Extension.ToLowerInvariant()
} | Select-String -Pattern $sensitivePatterns
foreach ($hit in $textHits) {
  $errors += "Sensitive text pattern found in $($hit.Path):$($hit.LineNumber)"
}

if ($errors.Count -gt 0) {
  $errors | ForEach-Object { Write-Error $_ }
  exit 1
}

Write-Output 'Open-source tree check passed.'
