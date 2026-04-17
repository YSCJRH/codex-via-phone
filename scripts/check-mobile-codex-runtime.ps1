$workspace = Split-Path -Parent $PSScriptRoot
$upstream = if ($env:MOBILE_CODEX_UPSTREAM_DIR) {
  $env:MOBILE_CODEX_UPSTREAM_DIR
} else {
  Join-Path $workspace 'vendor\claudecodeui-1.25.2'
}

function Resolve-NginxCommand {
  if ($env:MOBILE_CODEX_NGINX -and (Test-Path $env:MOBILE_CODEX_NGINX)) {
    return Get-Item $env:MOBILE_CODEX_NGINX -ErrorAction Stop
  }

  $found = Get-Command nginx -ErrorAction SilentlyContinue
  if ($found) {
    return $found
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
        return Get-Item $candidate -ErrorAction Stop
      }
    }
  }

  foreach ($candidate in @(
    'C:\Program Files\nginx\nginx.exe',
    'C:\nginx\nginx.exe'
  )) {
    if (Test-Path $candidate) {
      return Get-Item $candidate -ErrorAction Stop
    }
  }

  return $null
}

function Resolve-CommandPath($command) {
  if (-not $command) {
    return $null
  }

  if ($command.PSObject.Properties['Path']) {
    return $command.Path
  }

  if ($command.PSObject.Properties['FullName']) {
    return $command.FullName
  }

  return $null
}

$nodeCommand = if ($env:MOBILE_CODEX_NODE) {
  Get-Item $env:MOBILE_CODEX_NODE -ErrorAction Stop
} else {
  Get-Command node -ErrorAction SilentlyContinue
}

$nginxCommand = Resolve-NginxCommand

$tailscalePath = if ($env:MOBILE_CODEX_TAILSCALE) {
  $env:MOBILE_CODEX_TAILSCALE
} else {
  'C:\Program Files\Tailscale\tailscale.exe'
}

[PSCustomObject]@{
  Workspace = $workspace
  UpstreamExists = (Test-Path $upstream)
  UpstreamPath = $upstream
  Node = Resolve-CommandPath $nodeCommand
  Nginx = Resolve-CommandPath $nginxCommand
  Tailscale = if (Test-Path $tailscalePath) { $tailscalePath } else { $null }
  Python = Resolve-CommandPath (Get-Command python -ErrorAction SilentlyContinue)
} | Format-List
