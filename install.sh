#!/usr/bin/env bash
# Installs Watcharr after git clone, builds it, and starts it in the background.
# Works on macOS and Linux.
#
#   bash install.sh                 interactive, asks for each setting
#   bash install.sh --yes           accept every default (optional tokens are skipped)
#   bash install.sh --port 4300 --data-dir ~/watcharr-data --no-start
set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(pwd)"
ENV_FILE="$ROOT/.env.local"

YES=0
PORT_ARG=""
DATA_ARG=""
NO_START=0
while [ $# -gt 0 ]; do
  case "$1" in
    -y|--yes) YES=1 ;;
    --port) PORT_ARG="${2:-}"; shift ;;
    --data-dir) DATA_ARG="${2:-}"; shift ;;
    --no-start) NO_START=1 ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
die() { echo "Error: $1" >&2; exit 1; }

# ---------------------------------------------------------------- Node.js
step "Checking Node.js"
command -v node >/dev/null 2>&1 || die "Node.js is not installed. Install Node.js 20.9 or newer from https://nodejs.org, open a new terminal, and run this script again."
NODE_VERSION="$(node -p 'process.versions.node')"
NODE_MAJOR="${NODE_VERSION%%.*}"
NODE_MINOR="$(echo "$NODE_VERSION" | cut -d. -f2)"
if [ "$NODE_MAJOR" -lt 20 ] || { [ "$NODE_MAJOR" -eq 20 ] && [ "$NODE_MINOR" -lt 9 ]; }; then
  die "Node.js $NODE_VERSION is too old. Watcharr needs Node.js 20.9 or newer."
fi
echo "Node.js $NODE_VERSION found."

# ---------------------------------------------------------------- existing settings
current() { [ -f "$ENV_FILE" ] && grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }
CUR_PORT="$(current PORT)"
CUR_DATA="$(current DB_DIR)"
CUR_KEY="$(current APP_SECRET_KEY)"

# ---------------------------------------------------------------- questions
ask() {
  local prompt="$1" default="$2" answer
  if [ "$YES" -eq 1 ]; then echo "$default"; return; fi
  read -r -p "$prompt [$default]: " answer || true
  if [ -z "$answer" ]; then echo "$default"; else echo "$answer"; fi
}

ask_optional() {
  local prompt="$1" answer
  if [ "$YES" -eq 1 ]; then echo ""; return; fi
  read -r -p "$prompt (optional, press Enter to skip): " answer || true
  echo "$answer"
}

ask_secret() {
  local prompt="$1" answer
  if [ "$YES" -eq 1 ]; then echo ""; return; fi
  read -r -s -p "$prompt (optional, press Enter to skip): " answer || true
  echo >&2
  echo "$answer"
}

echo
echo "Watcharr setup"
echo "Press Enter to accept the value in [brackets]."
echo
printf '\033[33m%s\033[0m\n' "You can change the Hardcover token, Gotify settings, alerts and the re-check schedule later"
printf '\033[33m%s\033[0m\n' "in the app's Settings page. The port, data folder and encryption key live in .env.local"
printf '\033[33m%s\033[0m\n' "and are changed by running this script again or by editing that file."

PORT_VALUE="$(ask "Port for the web app" "${PORT_ARG:-${CUR_PORT:-4242}}")"

DATA_VALUE="$(ask "Data folder (database and encryption key)" "${DATA_ARG:-${CUR_DATA:-$ROOT/data}}")"
DATA_VALUE="${DATA_VALUE/#\~/$HOME}"
case "$DATA_VALUE" in
  /*) ;;
  *) DATA_VALUE="$ROOT/$DATA_VALUE" ;;
esac

# Encryption key: keep the existing one, or create one on first install.
SECRET_KEY="$CUR_KEY"
if [ -n "$SECRET_KEY" ]; then
  echo "Keeping the encryption key already in .env.local."
elif [ -f "$DATA_VALUE/.secret-key" ]; then
  echo "Using the encryption key already in $DATA_VALUE/.secret-key."
else
  SECRET_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
  echo "Generated a new encryption key and saved it to .env.local."
fi

# Optional connections (saved encrypted through the app once it is running).
HARDCOVER_TOKEN="$(ask_secret "Hardcover API token")"
GOTIFY_URL="$(ask_optional "Gotify server URL")"
GOTIFY_TOKEN=""
if [ -n "$GOTIFY_URL" ]; then GOTIFY_TOKEN="$(ask_secret "Gotify application token")"; fi

# ---------------------------------------------------------------- .env.local
step "Writing .env.local"
{
  echo "# Written by install.sh. Private to this machine; this file is gitignored."
  echo "PORT=$PORT_VALUE"
  echo "DB_DIR=$DATA_VALUE"
  if [ -n "$SECRET_KEY" ]; then echo "APP_SECRET_KEY=$SECRET_KEY"; fi
} > "$ENV_FILE"
chmod 600 "$ENV_FILE"
echo "Saved $ENV_FILE"

# ---------------------------------------------------------------- dependencies
step "Installing dependencies (npm ci)"
npm ci --no-audit --no-fund

# ---------------------------------------------------------------- database
step "Preparing the database"
mkdir -p "$DATA_VALUE"
if [ -f "$DATA_VALUE/book-release-tracker.sqlite" ]; then
  # Never run drizzle push over an existing database: it can drop columns.
  echo "Existing database found. Leaving its schema alone."
else
  DB_DIR="$DATA_VALUE" npx drizzle-kit push
  echo "Created a new database."
fi

# ---------------------------------------------------------------- build
step "Building Watcharr"
npm run build

# ---------------------------------------------------------------- start
if [ "$NO_START" -eq 1 ]; then
  step "Done (not started, as requested)"
  echo "Start it later with: bash start.sh"
  exit 0
fi

step "Starting Watcharr in the background"
bash "$ROOT/start.sh"

# ---------------------------------------------------------------- optional connections
BASE="http://localhost:$PORT_VALUE"
save_setting() {
  KEY="$1" VAL="$2" node -e 'console.log(JSON.stringify({key: process.env.KEY, value: process.env.VAL}))' \
    | curl -fsS -X POST "$BASE/api/settings" -H 'Content-Type: application/json' -d @- >/dev/null
}

if [ -n "$HARDCOVER_TOKEN" ]; then
  save_setting hardcoverApiKey "$HARDCOVER_TOKEN"
  MESSAGE="$(curl -fsS -X POST "$BASE/api/settings/test" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).message))')"
  echo "Hardcover: $MESSAGE"
fi
if [ -n "$GOTIFY_URL" ]; then
  save_setting gotifyUrl "$GOTIFY_URL"
  if [ -n "$GOTIFY_TOKEN" ]; then save_setting gotifyToken "$GOTIFY_TOKEN"; fi
  echo "Gotify settings saved. Use Send test in Settings to check them."
fi
HARDCOVER_TOKEN=""
GOTIFY_TOKEN=""

echo
printf '\033[1;32m%s\033[0m\n' "Watcharr is running at $BASE"
echo "Stop it with:  bash stop.sh"
echo "Start it with: bash start.sh"
