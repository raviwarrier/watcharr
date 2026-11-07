<#
.SYNOPSIS
  Stops Watcharr (Windows).

.DESCRIPTION
  Stops the server that start.ps1 started (recorded in .watcharr\app.pid). It also stops any Next.js
  server listening on Watcharr's port, even if start.ps1 didn't start it. Other programs are left alone.

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

# Stop a process tree (the cmd.exe wrapper and node).
function Stop-Tree([int]$ProcessId) {
  taskkill /PID $ProcessId /T /F 2>$null | Out-Null
}

$stopped = $false

# 1. The server start.ps1 recorded.
if (Test-Path $PidFile) {
  $processId = [int](Get-Content $PidFile -ErrorAction SilentlyContinue)
  $info = if ($processId) { Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue } else { $null }
  # Check it's really ours before stopping it (guards against a reused PID).
  if ($info -and ($info.CommandLine -like "*next*start*")) {
    Stop-Tree $processId
    Write-Host "Watcharr stopped."
    $stopped = $true
  }
  Remove-Item $PidFile -ErrorAction SilentlyContinue
}

# 2. Any other Next.js server on the port (for example, one started by hand).
$listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
foreach ($listener in $listeners) {
  $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
  if ($owner -and ($owner.CommandLine -like "*next*")) {
    # Stop only the server and its children. Never its parent, which could be the user's own terminal.
    Stop-Tree $owner.ProcessId
    Write-Host "Stopped the Next.js server on port $port that wasn't started by start.ps1 (PID $($owner.ProcessId))."
    $stopped = $true
  }
}

if (-not $stopped) {
  if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
    Write-Host "Something else is listening on port $port that doesn't look like Watcharr. Leaving it alone."
  } else {
    Write-Host "Watcharr is not running."
  }
}
exit 0
