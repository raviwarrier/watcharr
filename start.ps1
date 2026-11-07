<#
.SYNOPSIS
  Starts Watcharr in the background (Windows). Builds first if there is no build yet.

.DESCRIPTION
  Run it from the project folder:
      powershell -ExecutionPolicy Bypass -File .\start.ps1
#>
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
Set-Location $Root
$StateDir = Join-Path $Root ".watcharr"
$PidFile = Join-Path $StateDir "app.pid"
$LogFile = Join-Path $StateDir "app.log"
$ErrFile = Join-Path $StateDir "app.err.log"
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null

# Port from .env.local (written by install.ps1), default 4242.
$port = 4242
$envFile = Join-Path $Root ".env.local"
if (Test-Path $envFile) {
  foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*PORT=(\d+)\s*$') { $port = [int]$matches[1] }
  }
}
$base = "http://localhost:$port"

# Already running?
if (Test-Path $PidFile) {
  $existing = [int](Get-Content $PidFile -ErrorAction SilentlyContinue)
  if ($existing -and (Get-Process -Id $existing -ErrorAction SilentlyContinue)) {
    Write-Host "Watcharr is already running at $base"
    exit 0
  }
  Remove-Item $PidFile -ErrorAction SilentlyContinue
}

# Build if needed.
if (-not (Test-Path (Join-Path $Root ".next\BUILD_ID"))) {
  Write-Host "No build found. Building first (this takes a minute)..."
  npm run build
  if ($LASTEXITCODE -ne 0) { Write-Error "Build failed."; exit 1 }
}

Write-Host "Starting Watcharr on port $port in the background..."
# Start the server fully detached. Start-Process inherits handles from this script, so a caller
# that pipes or waits on our output would hang until the server exits. Win32_Process.Create
# shares no handles with us. cmd.exe does the redirection and stays alive until node exits,
# so the PID we save is a reliable "server is running" signal.
# Win32_Process.Create gives the process its own console window by default. Closing that window
# stops the server, so hide it (ShowWindow = 0). Hidden windows can't be closed by accident.
$startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
$command = "cmd.exe /c node node_modules\next\dist\bin\next start -p $port > `"$LogFile`" 2> `"$ErrFile`" < nul"
$created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $command; CurrentDirectory = $Root; ProcessStartupInformation = $startup }
if ($created.ReturnValue -ne 0) {
  Write-Host "Could not start the server (error code $($created.ReturnValue))."
  exit 1
}
$serverId = [int]$created.ProcessId
Set-Content -Path $PidFile -Value $serverId

# Wait until it answers.
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 1
  if (-not (Get-Process -Id $serverId -ErrorAction SilentlyContinue)) { break }
  try {
    $response = Invoke-WebRequest -Uri "$base/dashboard" -UseBasicParsing -TimeoutSec 3
    if ($response.StatusCode -eq 200) { $ready = $true; break }
  } catch { }
}

if (-not $ready) {
  Write-Host "Watcharr did not start. Last lines of the error log:"
  if (Test-Path $ErrFile) { Get-Content $ErrFile -Tail 20 }
  Remove-Item $PidFile -ErrorAction SilentlyContinue
  exit 1
}

Write-Host "Watcharr is running at $base" -ForegroundColor Green
exit 0
