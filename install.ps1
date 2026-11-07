<#
.SYNOPSIS
  Installs Watcharr after git clone, builds it, and starts it in the background (Windows).

.DESCRIPTION
  Asks for the settings it needs (with defaults), writes .env.local, installs dependencies,
  creates the database if there isn't one yet, builds the app, and starts it in the background.

  Run it from the project folder:
      powershell -ExecutionPolicy Bypass -File .\install.ps1

.PARAMETER Yes
  Accept every default without asking. Optional tokens are skipped.

.PARAMETER Port
  Port for the web app. Default: 4242.

.PARAMETER DataDir
  Folder for the database and encryption key. Default: .\data

.PARAMETER NoStart
  Install and build, but don't start the app.
#>
param(
  [switch]$Yes,
  [int]$Port = 0,
  [string]$DataDir = "",
  [switch]$NoStart
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
Set-Location $Root
$EnvFile = Join-Path $Root ".env.local"
$StateDir = Join-Path $Root ".watcharr"

function Write-Step([string]$Message) { Write-Host "`n==> $Message" -ForegroundColor Cyan }

function Invoke-Checked([string]$FilePath, [string[]]$Arguments) {
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) { throw "'$FilePath $($Arguments -join ' ')' failed with exit code $LASTEXITCODE." }
}

# ---------------------------------------------------------------- Node.js
Write-Step "Checking Node.js"
$nodeVersion = $null
try { $nodeVersion = (node -p "process.versions.node") } catch { }
if (-not $nodeVersion) {
  throw "Node.js is not installed. Install Node.js 20.9 or newer from https://nodejs.org, open a new terminal, and run this script again."
}
$major, $minor = $nodeVersion.Split('.') | Select-Object -First 2 | ForEach-Object { [int]$_ }
if ($major -lt 20 -or ($major -eq 20 -and $minor -lt 9)) {
  throw "Node.js $nodeVersion is too old. Watcharr needs Node.js 20.9 or newer."
}
Write-Host "Node.js $nodeVersion found."

# ---------------------------------------------------------------- existing settings
$current = @{}
if (Test-Path $EnvFile) {
  foreach ($line in Get-Content $EnvFile) {
    if ($line -match '^\s*([A-Z_]+)=(.*)$') { $current[$matches[1]] = $matches[2] }
  }
}

# ---------------------------------------------------------------- questions
Write-Host ""
Write-Host "Watcharr setup" -ForegroundColor Cyan
Write-Host "Press Enter to accept the value in [brackets]."
Write-Host ""
Write-Host "You can change the Hardcover token, Gotify settings, alerts and the re-check schedule later" -ForegroundColor Yellow
Write-Host "in the app's Settings page. The port, data folder and encryption key live in .env.local" -ForegroundColor Yellow
Write-Host "and are changed by running this script again or by editing that file." -ForegroundColor Yellow

function Read-Value([string]$Prompt, [string]$Default) {
  if ($Yes) { return $Default }
  $answer = Read-Host "$Prompt [$Default]"
  if ([string]::IsNullOrWhiteSpace($answer)) { return $Default }
  return $answer.Trim()
}

function Read-OptionalSecret([string]$Prompt) {
  if ($Yes) { return "" }
  $secure = Read-Host "$Prompt (optional, press Enter to skip)" -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Read-OptionalText([string]$Prompt) {
  if ($Yes) { return "" }
  return (Read-Host "$Prompt (optional, press Enter to skip)").Trim()
}

# Port
$defaultPort = if ($Port -gt 0) { "$Port" } elseif ($current["PORT"]) { $current["PORT"] } else { "4242" }
$portValue = [int](Read-Value "Port for the web app" $defaultPort)

# Data folder
$defaultData = if ($DataDir) { $DataDir } elseif ($current["DB_DIR"]) { $current["DB_DIR"] } else { Join-Path $Root "data" }
$dataValue = Read-Value "Data folder (database and encryption key)" $defaultData
$dataValue = [IO.Path]::GetFullPath($dataValue)

# Encryption key: keep the existing one, or create one on first install
$keyFile = Join-Path $dataValue ".secret-key"
$secretKey = $current["APP_SECRET_KEY"]
if ($secretKey) {
  Write-Host "Keeping the encryption key already in .env.local."
} elseif (Test-Path $keyFile) {
  Write-Host "Using the encryption key already in $keyFile."
} else {
  # Works on Windows PowerShell 5.1 too (no static GetBytes there).
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $rng.Dispose()
  $secretKey = [Convert]::ToBase64String($bytes)
  Write-Host "Generated a new encryption key and saved it to .env.local."
}

# Optional connections (saved encrypted through the app once it is running)
$hardcoverToken = Read-OptionalSecret "Hardcover API token"
$gotifyUrl = Read-OptionalText "Gotify server URL"
$gotifyToken = if ($gotifyUrl) { Read-OptionalSecret "Gotify application token" } else { "" }

# ---------------------------------------------------------------- write .env.local
Write-Step "Writing .env.local"
$lines = @(
  "# Written by install.ps1. Private to this machine; this file is gitignored.",
  "PORT=$portValue",
  "DB_DIR=$dataValue"
)
if ($secretKey) { $lines += "APP_SECRET_KEY=$secretKey" }
Set-Content -Path $EnvFile -Value $lines -Encoding utf8
Write-Host "Saved $EnvFile"

# ---------------------------------------------------------------- dependencies
Write-Step "Installing dependencies (npm ci)"
Invoke-Checked "npm" @("ci", "--no-audit", "--no-fund")

# ---------------------------------------------------------------- database
Write-Step "Preparing the database"
New-Item -ItemType Directory -Force -Path $dataValue | Out-Null
$dbFile = Join-Path $dataValue "book-release-tracker.sqlite"
if (Test-Path $dbFile) {
  # Never run drizzle push over an existing database: it can drop columns.
  Write-Host "Existing database found. Leaving its schema alone."
} else {
  $env:DB_DIR = $dataValue
  try { Invoke-Checked "npx" @("drizzle-kit", "push") } finally { Remove-Item Env:DB_DIR -ErrorAction SilentlyContinue }
  Write-Host "Created a new database."
}

# ---------------------------------------------------------------- build
Write-Step "Building Watcharr"
Invoke-Checked "npm" @("run", "build")

# ---------------------------------------------------------------- start
if ($NoStart) {
  Write-Step "Done (not started, as requested)"
  Write-Host "Start it later with: powershell -ExecutionPolicy Bypass -File .\start.ps1"
  exit 0
}

Write-Step "Starting Watcharr in the background"
& (Join-Path $Root "start.ps1")
if ($LASTEXITCODE -ne 0) { throw "Watcharr did not start. See .watcharr\app.err.log." }

# ---------------------------------------------------------------- save optional connections
$base = "http://localhost:$portValue"
function Save-Setting([string]$Key, [string]$Value) {
  $body = @{ key = $Key; value = $Value } | ConvertTo-Json -Compress
  Invoke-RestMethod -Method Post -Uri "$base/api/settings" -ContentType "application/json" -Body $body | Out-Null
}

if ($hardcoverToken) {
  Save-Setting "hardcoverApiKey" $hardcoverToken
  $test = Invoke-RestMethod -Method Post -Uri "$base/api/settings/test"
  Write-Host "Hardcover: $($test.message)"
}
if ($gotifyUrl) {
  Save-Setting "gotifyUrl" $gotifyUrl
  if ($gotifyToken) { Save-Setting "gotifyToken" $gotifyToken }
  Write-Host "Gotify settings saved. Use Send test in Settings to check them."
}
$hardcoverToken = $null
$gotifyToken = $null

Write-Host ""
Write-Host "Watcharr is running at $base" -ForegroundColor Green
Write-Host "Stop it with:  powershell -ExecutionPolicy Bypass -File .\stop.ps1"
Write-Host "Start it with: powershell -ExecutionPolicy Bypass -File .\start.ps1"
