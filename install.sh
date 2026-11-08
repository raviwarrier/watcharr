#!/usr/bin/env bash
# Installs Watcharr after git clone, builds it, and starts it in the background.
# Works on macOS and Linux.
#
#   bash install.sh                 interactive, asks for each setting
#   bash install.sh --yes           accept every default (also -a or --accept-defaults)
#   bash install.sh --port 4300 --data-dir ~/watcharr-data --no-start
#
# Re-running this script after an update keeps your access key and calendar link.
# It only creates new ones when you answer "yes" to the reset question (default: no).
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
    -y|--yes|-a|--accept-defaults) YES=1 ;;
    --port) PORT_ARG="${2:-}"; shift ;;
    --data-dir) DATA_ARG="${2:-}"; shift ;;
    --no-start) NO_START=1 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
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
CUR_ACCESS_HASH="$(current ACCESS_KEY_SHA256)"
CUR_CALENDAR_HASH="$(current CALENDAR_TOKEN_SHA256)"

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
  SECRET_KEY="$(node -p "require('crypto').randomBytes(32).toString('base64')")"
  echo "Generated a new encryption key and saved it to .env.local."
fi

# Optional connections (saved encrypted once the app is running, by signing in).
HARDCOVER_TOKEN="$(ask_secret "Hardcover API token")"
GOTIFY_URL="$(ask_optional "Gotify server URL")"
GOTIFY_TOKEN=""
if [ -n "$GOTIFY_URL" ]; then GOTIFY_TOKEN="$(ask_secret "Gotify application token")"; fi

# ---------------------------------------------------------------- stop a running copy
# Stop Watcharr first if it's running, so its files can be replaced.
step "Stopping Watcharr if it's running"
bash "$ROOT/stop.sh"
OLD_PORT="${CUR_PORT:-4242}"
PORT_BUSY=0
if command -v lsof >/dev/null 2>&1 && lsof -tiTCP:"$OLD_PORT" -sTCP:LISTEN >/dev/null 2>&1; then PORT_BUSY=1; fi
if command -v ss >/dev/null 2>&1 && [ -n "$(ss -ltnH "sport = :$OLD_PORT" 2>/dev/null || true)" ]; then PORT_BUSY=1; fi
if [ "$PORT_BUSY" -eq 1 ]; then
  die "Port $OLD_PORT is still in use after stopping Watcharr. Check with: sudo ss -ltnp | grep $OLD_PORT, stop that process, then run the install again."
fi

# ---------------------------------------------------------------- dependencies
step "Installing dependencies (npm ci)"
npm ci --no-audit --no-fund

# ---------------------------------------------------------------- access keys
# Does the app already have keys? Either .env.local has the hashes, or the database has a stored key.
DB_FILE="$DATA_VALUE/book-release-tracker.sqlite"
db_has_setting() {
  [ -f "$DB_FILE" ] || return 1
  node -e "const D=require('better-sqlite3');const db=new D(process.argv[1],{readonly:true});process.exit(db.prepare('select 1 from settings where key=?').get(process.argv[2])?0:1)" "$DB_FILE" "$1"
}

KEYS_EXIST=0
if [ -n "$CUR_ACCESS_HASH" ] || db_has_setting accessKeyHash; then KEYS_EXIST=1; fi

RESET=0
if [ "$KEYS_EXIST" -eq 1 ]; then
  echo
  echo "Your access key and calendar link already exist. Keep them unless you need new ones."
  echo "Choose yes only if you forgot the access key, or it may have fallen into the wrong hands."
  echo "Anyone using the old key or link will be signed out or stop getting calendar updates."
  if [ "$YES" -eq 0 ]; then
    read -r -p "Create new access key and calendar link? [y/N]: " ANSWER || true
    case "$ANSWER" in y|Y|yes|YES) RESET=1 ;; esac
  fi
  if [ "$RESET" -eq 1 ]; then echo "Creating new keys."; else echo "Keeping your existing keys."; fi
fi

ACCESS_KEY=""
CALENDAR_TOKEN=""
ACCESS_HASH="$CUR_ACCESS_HASH"
CALENDAR_HASH="$CUR_CALENDAR_HASH"
if [ "$RESET" -eq 1 ] || [ "$KEYS_EXIST" -eq 0 ]; then
  ACCESS_KEY="$(node -p "require('crypto').randomBytes(32).toString('hex')")"
  CALENDAR_TOKEN="$(node -p "require('crypto').randomBytes(32).toString('hex')")"
  ACCESS_HASH="$(K="$ACCESS_KEY" node -p "require('crypto').createHash('sha256').update(process.env.K).digest('hex')")"
  CALENDAR_HASH="$(K="$CALENDAR_TOKEN" node -p "require('crypto').createHash('sha256').update(process.env.K).digest('hex')")"
  if [ "$RESET" -eq 1 ] && [ -f "$DB_FILE" ]; then
    # Clear the stored copies the app uses in preference to .env.local, so the new keys take effect.
    node -e "const D=require('better-sqlite3');const db=new D(process.argv[1]);db.prepare(\"delete from settings where key in ('accessKeyHash','calendarToken')\").run();db.close()" "$DB_FILE"
  fi
fi

# ---------------------------------------------------------------- .env.local
step "Writing .env.local"
{
  echo "# Written by install.sh. Private to this machine; this file is gitignored."
  echo "PORT=$PORT_VALUE"
  echo "DB_DIR=$DATA_VALUE"
  if [ -n "$SECRET_KEY" ]; then echo "APP_SECRET_KEY=$SECRET_KEY"; fi
  if [ -n "$ACCESS_HASH" ]; then echo "ACCESS_KEY_SHA256=$ACCESS_HASH"; fi
  if [ -n "$CALENDAR_HASH" ]; then echo "CALENDAR_TOKEN_SHA256=$CALENDAR_HASH"; fi
} > "$ENV_FILE"
chmod 600 "$ENV_FILE"
echo "Saved $ENV_FILE"

# ---------------------------------------------------------------- database
step "Preparing the database"
mkdir -p "$DATA_VALUE"
if [ -f "$DB_FILE" ]; then
  # Never run drizzle push over an existing database: it can drop columns.
  echo "Existing database found. Leaving its schema alone."
else
  DB_DIR="$DATA_VALUE" npx drizzle-kit push
  echo "Created a new database."
fi

# ---------------------------------------------------------------- build
step "Building Watcharr"
npm run build

# ---------------------------------------------------------------- show new keys (once)
if [ -n "$ACCESS_KEY" ]; then
  cat <<EOF

==============================================================
  Your Watcharr access keys. Save them now.
==============================================================

  ACCESS KEY (64 characters). You type this to sign in.
    $ACCESS_KEY
  Anyone with this key can see your watchlist and change settings.
  Keep it private, and store it in a password manager.

  CALENDAR TOKEN (64 characters). Only for calendar app subscriptions.
    $CALENDAR_TOKEN
  Subscribe to this URL. If the calendar app is on another device, replace
  localhost with this computer's address:
    http://localhost:$PORT_VALUE/api/calendar.ics?token=$CALENDAR_TOKEN

  The access key is shown only once. Watcharr keeps only its hash.
  The calendar link can be shown again from the Calendar feed menu.
  To change them later, use Settings > Caution zone.
==============================================================
EOF
  # Keys are shown only once, so pause before the output scrolls away. Skipped when input is piped.
  if [ -t 0 ]; then
    read -r -p "Press Enter once you have saved them... " _ || true
  fi
fi

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
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

SIGNED_IN=0
if [ -n "$ACCESS_KEY" ]; then
  # Sign in with the key we just created, so the app accepts the calendar token and our settings.
  LOGIN_BODY="$(K="$ACCESS_KEY" node -p 'JSON.stringify({key: process.env.K})')"
  if curl -fsS -c "$JAR" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d "$LOGIN_BODY" >/dev/null; then
    SIGNED_IN=1
  else
    echo "Could not sign in to save the connection settings. Add them in Settings after signing in."
  fi
fi

save_setting() {
  local body
  body="$(KEY="$1" VAL="$2" node -p 'JSON.stringify({key: process.env.KEY, value: process.env.VAL})')"
  curl -fsS -b "$JAR" -X POST "$BASE/api/settings" -H 'Content-Type: application/json' -d "$body" >/dev/null
}

if [ -n "$HARDCOVER_TOKEN" ]; then
  if [ "$SIGNED_IN" -eq 1 ]; then
    save_setting hardcoverApiKey "$HARDCOVER_TOKEN"
    MESSAGE="$(curl -fsS -b "$JAR" -X POST "$BASE/api/settings/test" | node -p 'JSON.parse(require("fs").readFileSync(0,"utf8")).message')"
    echo "Hardcover: $MESSAGE"
  else
    echo "Hardcover token not saved. Add it in Settings after signing in."
  fi
fi
if [ -n "$GOTIFY_URL" ]; then
  if [ "$SIGNED_IN" -eq 1 ]; then
    save_setting gotifyUrl "$GOTIFY_URL"
    if [ -n "$GOTIFY_TOKEN" ]; then save_setting gotifyToken "$GOTIFY_TOKEN"; fi
    echo "Gotify settings saved. Use Send test in Settings to check them."
  else
    echo "Gotify settings not saved. Add them in Settings after signing in."
  fi
fi

if [ "$SIGNED_IN" -eq 1 ] && [ -n "$CALENDAR_TOKEN" ]; then
  # Store the calendar token (encrypted) so the app can show the subscription link later.
  TOKEN_BODY="$(K="$CALENDAR_TOKEN" node -p 'JSON.stringify({token: process.env.K})')"
  curl -fsS -b "$JAR" -X POST "$BASE/api/security/set-calendar-token" -H 'Content-Type: application/json' -d "$TOKEN_BODY" >/dev/null \
    && echo "Calendar subscription link is available in the app's Calendar feed menu." \
    || echo "Could not store the calendar token. Use Rotate calendar token in Settings if the feed link stops working."
fi
HARDCOVER_TOKEN=""
GOTIFY_TOKEN=""
ACCESS_KEY=""
CALENDAR_TOKEN=""

# ---------------------------------------------------------------- systemd service (OFF)
# The recommended way to keep Watcharr running on Linux is PM2 (see example.ecosystem.config.js and the README).
# The systemd block below is commented out on purpose. To run Watcharr as a systemd service instead,
# uncomment every line from "SERVICE_FILE=" to "sudo systemctl enable --now watcharr" and run this
# script again. Stop the background copy first (bash stop.sh) so the port is free.
#
# SERVICE_FILE=/etc/systemd/system/watcharr.service
# sudo tee "$SERVICE_FILE" >/dev/null <<UNIT
# [Unit]
# Description=Watcharr
# After=network-online.target
# Wants=network-online.target
#
# [Service]
# Type=simple
# User=$USER
# WorkingDirectory=$ROOT
# ExecStart=$(command -v node) $ROOT/node_modules/next/dist/bin/next start -p $PORT_VALUE
# Restart=on-failure
# RestartSec=5
#
# [Install]
# WantedBy=multi-user.target
# UNIT
# sudo systemctl daemon-reload
# sudo systemctl enable --now watcharr

echo
printf '\033[1;32m%s\033[0m\n' "Watcharr is running at $BASE"
echo "Sign in with your access key. Stop it with:  bash stop.sh"
echo "Start it with: bash start.sh"
