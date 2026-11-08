#!/usr/bin/env bash
# Starts Watcharr via PM2. Builds first if there is no build yet.
#   bash start_pm2.sh
set -euo pipefail

APP_DIR="/srv/Appdata/local/watcharr"
ECOSYSTEM_CONFIG="/home/raviwarrier/ecosystem.config.js"

cd "$APP_DIR"

PORT="$( (grep -E '^PORT=' .env.local 2>/dev/null || true) | tail -1 | cut -d= -f2-)"
PORT="${PORT:-4242}"
BASE="http://localhost:$PORT"

# Check if PM2 is already managing Watcharr and it's running
if pm2 pid watcharr 2>/dev/null | grep -E -q '^[0-9]+$'; then
  echo "Watcharr is already running via PM2 at $BASE"
  exit 0
fi

# Build if needed
if [ ! -f "$APP_DIR/.next/BUILD_ID" ]; then
  echo "No build found. Building first (this takes a minute)..."
  npm run build
fi

echo "Starting Watcharr on port $PORT via PM2..."
pm2 start "$ECOSYSTEM_CONFIG"
pm2 save

# Wait until it answers.
for _ in $(seq 1 60); do
  sleep 1
  if curl -fsS -o /dev/null "$BASE/dashboard" 2>/dev/null; then
    echo "Watcharr is running at $BASE"
    exit 0
  fi
done

echo "Watcharr did not respond on time. PM2 status and last lines of error log:"
pm2 status watcharr
pm2 logs watcharr --err --lines 20 --nobackup
exit 1