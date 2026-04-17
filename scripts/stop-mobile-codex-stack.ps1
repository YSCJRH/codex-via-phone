$workspace = Split-Path -Parent $PSScriptRoot
$powershellExe = Join-Path $PSHOME 'powershell.exe'
$netstatExe = Join-Path $env:SystemRoot 'System32\netstat.exe'
& $powershellExe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $workspace 'scripts\stop-mobile-codex-nginx.ps1') | Out-Null

function Get-ListenerPids {
  param(
    [Parameter(Mandatory = $true)]
    [int]$Port
  )

  $pids = @()

  try {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop
    if ($listener) {
      $pids += $listener | Select-Object -ExpandProperty OwningProcess -Unique
    }
  } catch {
  }

  if (-not $pids -or $pids.Count -eq 0) {
    $netstatLines = & $netstatExe -ano -p tcp | Select-String -Pattern (":{0}\s+.*LISTENING\s+(\d+)$" -f $Port)
    foreach ($line in $netstatLines) {
      if ($line.Matches.Count -gt 0) {
        $listenerPid = [int]$line.Matches[0].Groups[1].Value
        if ($listenerPid -gt 0) {
          $pids += $listenerPid
        }
      }
    }
  }

  return $pids | Sort-Object -Unique
}

$ports = @(3001, 8080)
foreach ($port in $ports) {
  Get-ListenerPids -Port $port | ForEach-Object {
    Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
  }
}
