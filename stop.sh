#!/usr/bin/env bash
# Stops Watcharr if start.sh started it (macOS and Linux).
#   bash stop.sh
set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(pwd)"
PID_FILE="$ROOT/.watcharr/app.pid"

PORT="$( (grep -E '^PORT=' .env.local 2>/dev/null || true) | tail -1 | cut -d= -f2-)"
PORT="${PORT:-4242}"

if [ ! -f "$PID_FILE" ]; then
  if command -v lsof >/dev/null 2>&1 && lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Something is listening on port $PORT, but start.sh didn't start it. Leaving it alone."
  else
    echo "Watcharr is not running."
  fi
  exit 0
fi

PID="$(cat "$PID_FILE")"
# The PID file is ours. Check the process name too when ps can report it, to guard against a reused PID.
COMM="$(ps -o comm= -p "$PID" 2>/dev/null || true)"
if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null && { [ -z "$COMM" ] || echo "$COMM" | grep -q node; }; then
  # Stop child processes first, then the app itself.
  pkill -TERM -P "$PID" 2>/dev/null || true
  kill -TERM "$PID" 2>/dev/null || true
  for _ in $(seq 1 10); do
    kill -0 "$PID" 2>/dev/null || break
    sleep 1
  done
  if kill -0 "$PID" 2>/dev/null; then
    pkill -KILL -P "$PID" 2>/dev/null || true
    kill -KILL "$PID" 2>/dev/null || true
  fi
  echo "Watcharr stopped."
else
  echo "Watcharr was not running (stale PID file removed)."
fi
rm -f "$PID_FILE"
