<#
.SYNOPSIS
  Installs Watcharr after git clone, builds it, and starts it in the background (Windows).

.DESCRIPTION
  Asks for the settings it needs (with defaults), writes .env.local, installs dependencies,
  creates the database if there isn't one yet, builds the app, and starts it in the background.
  On first install it creates an access key and a calendar link and shows them once.

  Re-running it after an update keeps your access key and calendar link. It creates new ones only
  if you answer "yes" to the reset question (default: no).

  Run it from the project folder:
      powershell -ExecutionPolicy Bypass -File .\install.ps1

.PARAMETER Yes
  Accept every default without asking (also -AcceptDefaults or -a). Optional tokens are skipped,
  and keys are kept. On a first install, new keys are still shown, and you're still asked to press Enter
  once you've saved them.

.PARAMETER Port
  Port for the web app. Default: 4242.

.PARAMETER DataDir
  Folder for the database and encryption key. Default: .\data

.PARAMETER NoStart
  Install and build, but don't start the app.
#>
param(
  [Alias("AcceptDefaults", "a")]
  [switch]$Yes,
  [int]$Port = 0,
  [string]$DataDir = "",
  [switch]$NoStart
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
Set-Location $Root
$EnvFile = Join-Path $Root ".env.local"

function Write-Step([string]$Message) { Write-Host "`n==> $Message" -ForegroundColor Cyan }

function Invoke-Checked([string]$FilePath, [string[]]$Arguments) {
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) { throw "'$FilePath $($Arguments -join ' ')' failed with exit code $LASTEXITCODE." }
}

function New-HexSecret {
  # 32 random bytes as 64 hex characters.
  return (node -p "require('crypto').randomBytes(32).toString('hex')").Trim()
}

function Get-Sha256Hex([string]$Value) {
  $env:WATCHARR_HASH_INPUT = $Value
  try {
    return (node -p "require('crypto').createHash('sha256').update(process.env.WATCHARR_HASH_INPUT).digest('hex')").Trim()
  } finally {
    Remove-Item Env:WATCHARR_HASH_INPUT -ErrorAction SilentlyContinue
  }
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
    if ($line -match '^\s*([A-Z_0-9]+)=(.*)$') { $current[$matches[1]] = $matches[2] }
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
  # The app expects this key in base64.
  $secretKey = (node -p "require('crypto').randomBytes(32).toString('base64')").Trim()
  Write-Host "Generated a new encryption key and saved it to .env.local."
}

# Optional connections (saved encrypted once the app is running, by signing in)
$hardcoverToken = Read-OptionalSecret "Hardcover API token"
$gotifyUrl = Read-OptionalText "Gotify server URL"
$gotifyToken = if ($gotifyUrl) { Read-OptionalSecret "Gotify application token" } else { "" }

# ---------------------------------------------------------------- stop a running copy
# Windows won't replace files that a running app is using, so stop Watcharr first if it's running.
Write-Step "Stopping Watcharr if it's running"
& (Join-Path $Root "stop.ps1")
$oldPort = if ($current["PORT"]) { [int]$current["PORT"] } else { 4242 }
if (Get-NetTCPConnection -LocalPort $oldPort -State Listen -ErrorAction SilentlyContinue) {
  throw "Something else is using port $oldPort, and it wasn't started by start.ps1. Stop it, then run the install again."
}

# ---------------------------------------------------------------- dependencies
Write-Step "Installing dependencies (npm ci)"
Invoke-Checked "npm" @("ci", "--no-audit", "--no-fund")

# ---------------------------------------------------------------- access keys
# Does the app already have keys? Either .env.local has the hashes, or the database has a stored key.
$dbFile = Join-Path $dataValue "book-release-tracker.sqlite"
function Test-DbSetting([string]$Key) {
  if (-not (Test-Path $dbFile)) { return $false }
  $env:WATCHARR_DB = $dbFile
  $env:WATCHARR_KEY = $Key
  try {
    node -e "const D=require('better-sqlite3');const db=new D(process.env.WATCHARR_DB,{readonly:true});process.exit(db.prepare('select 1 from settings where key=?').get(process.env.WATCHARR_KEY)?0:1)"
    return ($LASTEXITCODE -eq 0)
  } finally {
    Remove-Item Env:WATCHARR_DB, Env:WATCHARR_KEY -ErrorAction SilentlyContinue
  }
}

$keysExist = [bool]$current["ACCESS_KEY_SHA256"] -or (Test-DbSetting "accessKeyHash")

$reset = $false
if ($keysExist) {
  Write-Host ""
  Write-Host "Your access key and calendar link already exist. Keep them unless you need new ones." -ForegroundColor Yellow
  Write-Host "Choose yes only if you forgot the access key, or it may have fallen into the wrong hands." -ForegroundColor Yellow
  Write-Host "Anyone using the old key or link will be signed out or stop getting calendar updates." -ForegroundColor Yellow
  if (-not $Yes) {
    $answer = Read-Host "Create new access key and calendar link? [y/N]"
    if ($answer -match '^(y|yes)$') { $reset = $true }
  }
  if ($reset) { Write-Host "Creating new keys." } else { Write-Host "Keeping your existing keys." }
}

$accessKey = ""
$calendarToken = ""
$accessHash = $current["ACCESS_KEY_SHA256"]
$calendarHash = $current["CALENDAR_TOKEN_SHA256"]
if ($reset -or -not $keysExist) {
  $accessKey = New-HexSecret
  $calendarToken = New-HexSecret
  $accessHash = Get-Sha256Hex $accessKey
  $calendarHash = Get-Sha256Hex $calendarToken
  if ($reset -and (Test-Path $dbFile)) {
    # Clear the stored copies the app uses in preference to .env.local, so the new keys take effect.
    $env:WATCHARR_DB = $dbFile
    $env:WATCHARR_SQL = "delete from settings where key in ('accessKeyHash','calendarToken')"
    try {
      node -e "const D=require('better-sqlite3');const db=new D(process.env.WATCHARR_DB);db.prepare(process.env.WATCHARR_SQL).run();db.close()"
      if ($LASTEXITCODE -ne 0) { throw "Could not clear the stored keys." }
    } finally {
      Remove-Item Env:WATCHARR_DB, Env:WATCHARR_SQL -ErrorAction SilentlyContinue
    }
  }
}

# ---------------------------------------------------------------- write .env.local
Write-Step "Writing .env.local"
$lines = @(
  "# Written by install.ps1. Private to this machine; this file is gitignored.",
  "PORT=$portValue",
  "DB_DIR=$dataValue"
)
if ($secretKey) { $lines += "APP_SECRET_KEY=$secretKey" }
if ($accessHash) { $lines += "ACCESS_KEY_SHA256=$accessHash" }
if ($calendarHash) { $lines += "CALENDAR_TOKEN_SHA256=$calendarHash" }
Set-Content -Path $EnvFile -Value $lines -Encoding utf8
Write-Host "Saved $EnvFile"

# ---------------------------------------------------------------- database
Write-Step "Preparing the database"
New-Item -ItemType Directory -Force -Path $dataValue | Out-Null
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

# ---------------------------------------------------------------- show new keys (once)
if ($accessKey) {
  Write-Host ""
  Write-Host "==============================================================" -ForegroundColor Yellow
  Write-Host "  Your Watcharr access keys. Save them now." -ForegroundColor Yellow
  Write-Host "==============================================================" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "  ACCESS KEY (64 characters). You type this to sign in." -ForegroundColor Green
  Write-Host "    $accessKey"
  Write-Host "  Anyone with this key can see your watchlist and change settings."
  Write-Host "  Keep it private, and store it in a password manager."
  Write-Host ""
  Write-Host "  CALENDAR TOKEN (64 characters). Only for calendar app subscriptions." -ForegroundColor Green
  Write-Host "    $calendarToken"
  Write-Host "  Subscribe to this URL. If the calendar app is on another device, replace"
  Write-Host "  localhost with this computer's address:"
  Write-Host "    http://localhost:$portValue/api/calendar.ics?token=$calendarToken"
  Write-Host ""
  Write-Host "  The access key is shown only once. Watcharr keeps only its hash."
  Write-Host "  The calendar link can be shown again from the Calendar feed menu."
  Write-Host "  To change them later, use Settings > Caution zone."
  Write-Host "=============================================================="
  # Keys are shown only once, so pause before the output scrolls away. Skipped when input is piped.
  if (-not [Console]::IsInputRedirected) { Read-Host "Press Enter once you have saved them" | Out-Null }
}

# ---------------------------------------------------------------- start
if ($NoStart) {
  Write-Step "Done (not started, as requested)"
  Write-Host "Start it later with: powershell -ExecutionPolicy Bypass -File .\start.ps1"
  exit 0
}

Write-Step "Starting Watcharr in the background"
& (Join-Path $Root "start.ps1")
if ($LASTEXITCODE -ne 0) { throw "Watcharr did not start. See .watcharr\app.err.log." }

# ---------------------------------------------------------------- optional connections
$base = "http://localhost:$portValue"
$session = $null
if ($accessKey) {
  # Sign in with the key we just created, so the app accepts the calendar token and our settings.
  try {
    $loginBody = @{ key = $accessKey } | ConvertTo-Json -Compress
    Invoke-WebRequest -Method Post -Uri "$base/api/auth/login" -ContentType "application/json" -Body $loginBody -SessionVariable session -UseBasicParsing | Out-Null
  } catch {
    Write-Host "Could not sign in to save the connection settings. Add them in Settings after signing in."
    $session = $null
  }
}

function Save-Setting([string]$Key, [string]$Value) {
  $body = @{ key = $Key; value = $Value } | ConvertTo-Json -Compress
  Invoke-RestMethod -Method Post -Uri "$base/api/settings" -ContentType "application/json" -Body $body -WebSession $session | Out-Null
}

if ($hardcoverToken) {
  if ($session) {
    Save-Setting "hardcoverApiKey" $hardcoverToken
    $test = Invoke-RestMethod -Method Post -Uri "$base/api/settings/test" -WebSession $session
    Write-Host "Hardcover: $($test.message)"
  } else {
    Write-Host "Hardcover token not saved. Add it in Settings after signing in."
  }
}
if ($gotifyUrl) {
  if ($session) {
    Save-Setting "gotifyUrl" $gotifyUrl
    if ($gotifyToken) { Save-Setting "gotifyToken" $gotifyToken }
    Write-Host "Gotify settings saved. Use Send test in Settings to check them."
  } else {
    Write-Host "Gotify settings not saved. Add them in Settings after signing in."
  }
}
if ($session -and $calendarToken) {
  # Store the calendar token (encrypted) so the app can show the subscription link later.
  try {
    $tokenBody = @{ token = $calendarToken } | ConvertTo-Json -Compress
    Invoke-RestMethod -Method Post -Uri "$base/api/security/set-calendar-token" -ContentType "application/json" -Body $tokenBody -WebSession $session | Out-Null
    Write-Host "Calendar subscription link is available in the app's Calendar feed menu."
  } catch {
    Write-Host "Could not store the calendar token. Use Rotate calendar token in Settings if the feed link stops working."
  }
}
$hardcoverToken = $null
$gotifyToken = $null
$accessKey = $null
$calendarToken = $null

Write-Host ""
Write-Host "Watcharr is running at $base" -ForegroundColor Green
Write-Host "Sign in with your access key. Stop it with:  powershell -ExecutionPolicy Bypass -File .\stop.ps1"
Write-Host "Start it with: powershell -ExecutionPolicy Bypass -File .\start.ps1"
