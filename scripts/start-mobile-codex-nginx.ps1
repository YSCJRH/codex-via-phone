$workspace = Split-Path -Parent $PSScriptRoot
$asciiAlias = if ($env:MOBILE_CODEX_ASCII_ALIAS) {
  $env:MOBILE_CODEX_ASCII_ALIAS
} else {
  Join-Path (Split-Path -Parent $workspace) 'mobileCodexHelper_ascii'
}

function Normalize-ProcessPathEnvironment {
  $pathValues = @(
    [Environment]::GetEnvironmentVariable('Path', 'Process'),
    [Environment]::GetEnvironmentVariable('PATH', 'Process')
  ) | Where-Object { $_ }

  if ($pathValues.Count -eq 0) {
    return
  }

  $normalizedPath = (
    $pathValues |
      ForEach-Object { $_ -split ';' } |
      Where-Object { $_ } |
      Select-Object -Unique
  ) -join ';'

  [Environment]::SetEnvironmentVariable('Path', $normalizedPath, 'Process')
  [Environment]::SetEnvironmentVariable('PATH', $null, 'Process')
}

function Resolve-NginxCommand {
  if ($env:MOBILE_CODEX_NGINX -and (Test-Path $env:MOBILE_CODEX_NGINX)) {
    return $env:MOBILE_CODEX_NGINX
  }

  $found = Get-Command nginx -ErrorAction SilentlyContinue
  if ($found) {
    return $found.Path
  }

  $wingetRoot = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
  $wingetPackage = Get-ChildItem -Path $wingetRoot -Directory -Filter 'nginxinc.nginx*' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($wingetPackage) {
    $wingetVersionDir = Get-ChildItem -Path $wingetPackage.FullName -Directory -Filter 'nginx-*' -ErrorAction SilentlyContinue |
      Sort-Object Name -Descending |
      Select-Object -First 1
    if ($wingetVersionDir) {
      $candidate = Join-Path $wingetVersionDir.FullName 'nginx.exe'
      if (Test-Path $candidate) {
        return $candidate
      }
    }
  }

  foreach ($candidate in @(
    'C:\Program Files\nginx\nginx.exe',
    'C:\nginx\nginx.exe'
  )) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  throw 'nginx not found. Set MOBILE_CODEX_NGINX if needed.'
}

if (-not (Test-Path $asciiAlias)) {
  New-Item -ItemType Junction -Path $asciiAlias -Target $workspace | Out-Null
}

$nginxCmd = Resolve-NginxCommand

$nginxRoot = Join-Path $asciiAlias '.runtime\nginx'
$confRoot = Join-Path $nginxRoot 'conf'
$logsRoot = Join-Path $nginxRoot 'logs'
$tempRoot = Join-Path $nginxRoot 'temp'
New-Item -ItemType Directory -Force -Path $confRoot | Out-Null
New-Item -ItemType Directory -Force -Path $logsRoot | Out-Null
New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null

Copy-Item -Force (Join-Path $workspace 'deploy\nginx-mobile-codex.conf') (Join-Path $confRoot 'mobile-codex-nginx.conf')
Copy-Item -Force (Join-Path $workspace 'deploy\nginx-mime.types') (Join-Path $confRoot 'mime.types')

$netstatCmd = Join-Path $env:SystemRoot 'System32\netstat.exe'

Normalize-ProcessPathEnvironment
Start-Process -FilePath $nginxCmd -ArgumentList @(
  '-p', $nginxRoot,
  '-c', 'conf/mobile-codex-nginx.conf'
) -WorkingDirectory $nginxRoot -WindowStyle Hidden | Out-Null

$listening = $false
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  Start-Sleep -Seconds 1
  $netstat = & $netstatCmd -ano | Select-String -Pattern '127\.0\.0\.1:8080\s+.*LISTENING'
  if ($netstat) {
    $listening = $true
    break
  }
}

if (-not $listening) {
  $errorLog = Join-Path $logsRoot 'error.log'
  $mobileErrorLog = Join-Path $logsRoot 'mobile-codex.error.log'
  throw "nginx did not start listening on 127.0.0.1:8080. Check $errorLog and $mobileErrorLog"
}
