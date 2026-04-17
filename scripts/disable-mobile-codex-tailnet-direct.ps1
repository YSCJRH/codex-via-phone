$ruleName = 'MobileCodexTailnet3001'
$existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existingRule) {
  $existingRule | Remove-NetFirewallRule
}

$showOutput = & netsh interface portproxy show v4tov4
foreach ($line in ($showOutput -split "`r?`n")) {
  if ($line -match '^\s*(100\.\d{1,3}\.\d{1,3}\.\d{1,3})\s+3001\s+127\.0\.0\.1\s+3001\s*$') {
    $listenAddress = $Matches[1]
    & netsh interface portproxy delete v4tov4 listenaddress=$listenAddress listenport=3001 | Out-Null
  }
}

Write-Output 'Tailnet direct access disabled.'
