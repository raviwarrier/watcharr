#!/usr/bin/env bash
# Starts Watcharr in the background (macOS and Linux). Builds first if there is no build yet.
#   bash start.sh
set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(pwd)"
STATE="$ROOT/.watcharr"
PID_FILE="$STATE/app.pid"
LOG_FILE="$STATE/app.log"
ERR_FILE="$STATE/app.err.log"
mkdir -p "$STATE"

PORT="$( (grep -E '^PORT=' .env.local 2>/dev/null || true) | tail -1 | cut -d= -f2-)"
PORT="${PORT:-4242}"
BASE="http://localhost:$PORT"

# Already running?
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "Watcharr is already running at $BASE"
  exit 0
fi
rm -f "$PID_FILE"

# Build if needed.
if [ ! -f "$ROOT/.next/BUILD_ID" ]; then
  echo "No build found. Building first (this takes a minute)..."
  npm run build
fi

echo "Starting Watcharr on port $PORT in the background..."
nohup node "$ROOT/node_modules/next/dist/bin/next" start -p "$PORT" >"$LOG_FILE" 2>"$ERR_FILE" </dev/null &
echo $! > "$PID_FILE"

# Wait until it answers.
for _ in $(seq 1 60); do
  sleep 1
  if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then break; fi
  if curl -fsS -o /dev/null "$BASE/dashboard" 2>/dev/null; then
    echo "Watcharr is running at $BASE"
    exit 0
  fi
done

echo "Watcharr did not start. Last lines of the error log:"
tail -20 "$ERR_FILE" 2>/dev/null || true
rm -f "$PID_FILE"
exit 1
