<#
.SYNOPSIS
  Stops Watcharr if start.ps1 started it (Windows).

.DESCRIPTION
  Run it from the project folder:
      powershell -ExecutionPolicy Bypass -File .\stop.ps1
#>
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$PidFile = Join-Path $Root ".watcharr\app.pid"

$port = 4242
$envFile = Join-Path $Root ".env.local"
if (Test-Path $envFile) {
  foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*PORT=(\d+)\s*$') { $port = [int]$matches[1] }
  }
}

if (-not (Test-Path $PidFile)) {
  $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    Write-Host "Something is listening on port $port, but start.ps1 didn't start it. Leaving it alone."
  } else {
    Write-Host "Watcharr is not running."
  }
  exit 0
}

$processId = [int](Get-Content $PidFile -ErrorAction SilentlyContinue)
$process = if ($processId) { Get-Process -Id $processId -ErrorAction SilentlyContinue } else { $null }

# The saved PID is the cmd.exe wrapper that runs node. Check it really is ours
# (guards against a reused PID).
$isOurs = $false
if ($process) {
  $info = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
  $isOurs = $info -and ($info.CommandLine -like "*next*start*")
}

if ($isOurs) {
  # /T also stops any child processes; /F forces it if the app doesn't exit.
  taskkill /PID $processId /T /F | Out-Null
  Write-Host "Watcharr stopped."
} else {
  Write-Host "Watcharr was not running (stale PID file removed)."
}
Remove-Item $PidFile -ErrorAction SilentlyContinue
exit 0
