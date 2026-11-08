#!/usr/bin/env bash
# Stops Watcharr via PM2.
#   bash stop_pm2.sh
set -euo pipefail

APP_DIR="/srv/Appdata/local/watcharr"
cd "$APP_DIR"

PORT="$( (grep -E '^PORT=' .env.local 2>/dev/null || true) | tail -1 | cut -d= -f2-)"
PORT="${PORT:-4242}"

PRIV=""
if [ "$(id -u)" -ne 0 ]; then PRIV="sudo"; fi

stop_pid() {
  local pid="$1" priv="${2:-}"
  $priv kill -TERM "$pid" 2>/dev/null || true
  for _ in $(seq 1 10); do
    $priv kill -0 "$pid" 2>/dev/null || return 0
    sleep 1
  done
  $priv kill -KILL "$pid" 2>/dev/null || true
}

listener_pids() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true
  elif command -v ss >/dev/null 2>&1; then
    ss -ltnpH "sport = :$PORT" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u || true
  fi
}

privileged_listener_pids() {
  command -v ss >/dev/null 2>&1 || return 0
  $PRIV ss -ltnpH "sport = :$PORT" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u || true
}

port_in_use() {
  if command -v lsof >/dev/null 2>&1 && lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null 2>&1; then return 0; fi
  if command -v ss >/dev/null 2>&1 && [ -n "$(ss -ltnH "sport = :$PORT" 2>/dev/null || true)" ]; then return 0; fi
  return 1
}

STOPPED=0

# 1. Primary stop method: PM2
if pm2 pid watcharr 2>/dev/null | grep -E -q '^[0-9]+$'; then
  pm2 stop watcharr >/dev/null 2>&1 || true
  echo "Stopped Watcharr via PM2."
  STOPPED=1
fi

# 2. Fallback: Clean up any lingering Next.js processes on the port
for PID in $(listener_pids); do
  CWD=""
  if [ -e "/proc/$PID/cwd" ]; then
    CWD="$(readlink "/proc/$PID/cwd" 2>/dev/null || true)"
  fi
  ARGS="$(ps -o args= -p "$PID" 2>/dev/null || true)"
  if [ "$CWD" = "$APP_DIR" ] || echo "$ARGS" | grep -qi 'next'; then
    stop_pid "$PID"
    echo "Stopped lingering Next.js server on port $PORT (PID $PID)."
    STOPPED=1
  fi
done

if port_in_use; then
  for PID in $(privileged_listener_pids); do
    ARGS="$($PRIV ps -o args= -p "$PID" 2>/dev/null || true)"
    if echo "$ARGS" | grep -qi 'next'; then
      stop_pid "$PID" "$PRIV"
      echo "Stopped lingering Next.js server on port $PORT (PID $PID, root/other user)."
      STOPPED=1
    fi
  done
fi

if port_in_use; then
  echo "Port $PORT is still in use by another application. Please check with: sudo ss -ltnp | grep $PORT"
  exit 1
fi

if [ "$STOPPED" -eq 0 ]; then
  echo "Watcharr is not running."
fi