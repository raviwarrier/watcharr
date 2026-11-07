#!/usr/bin/env bash
# Stops Watcharr (macOS and Linux).
#   bash stop.sh
#
# Stops two kinds of process:
#   1. The one start.sh started (recorded in .watcharr/app.pid).
#   2. Any other process listening on Watcharr's port that runs from this project folder,
#      for example one started by hand with `next start`. Processes from other folders are left alone.
set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(pwd)"
PID_FILE="$ROOT/.watcharr/app.pid"

PORT="$( (grep -E '^PORT=' .env.local 2>/dev/null || true) | tail -1 | cut -d= -f2-)"
PORT="${PORT:-4242}"

# Stop a process politely, then forcefully if it doesn't exit.
stop_pid() {
  local pid="$1"
  kill -TERM "$pid" 2>/dev/null || true
  pkill -TERM -P "$pid" 2>/dev/null || true
  for _ in $(seq 1 10); do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 1
  done
  pkill -KILL -P "$pid" 2>/dev/null || true
  kill -KILL "$pid" 2>/dev/null || true
}

# PIDs of processes listening on the port (lsof if available, otherwise ss).
listener_pids() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true
  elif command -v ss >/dev/null 2>&1; then
    ss -ltnpH "sport = :$PORT" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u || true
  fi
}

# Working directory of a process (Linux /proc, or lsof on macOS).
cwd_of() {
  local pid="$1"
  if [ -e "/proc/$pid/cwd" ]; then
    readlink "/proc/$pid/cwd" 2>/dev/null || true
  elif command -v lsof >/dev/null 2>&1; then
    lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1
  fi
}

STOPPED=0

# 1. The process start.sh recorded.
if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE")"
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    stop_pid "$PID"
    echo "Watcharr stopped."
    STOPPED=1
  fi
  rm -f "$PID_FILE"
fi

# 2. Any other Next.js server on the port. Watcharr's port is set in .env.local, so a Next.js
#    server there is almost always an earlier Watcharr (for example, one started by hand).
for PID in $(listener_pids); do
  CWD="$(cwd_of "$PID")"
  ARGS="$(ps -o args= -p "$PID" 2>/dev/null || true)"
  if [ "$CWD" = "$ROOT" ] || echo "$ARGS" | grep -qi 'next'; then
    stop_pid "$PID"
    echo "Stopped the Next.js server on port $PORT (PID $PID, folder: ${CWD:-unknown}, command: ${ARGS:-unknown})."
    STOPPED=1
  fi
done

if [ "$STOPPED" -eq 0 ]; then
  if [ -n "$(listener_pids)" ]; then
    echo "Something else is listening on port $PORT, and it doesn't look like Watcharr. Leaving it alone."
  elif command -v ss >/dev/null 2>&1 && [ -n "$(ss -ltnH "sport = :$PORT" 2>/dev/null)" ]; then
    echo "Port $PORT is in use, but I can't tell which process owns it. Check with: sudo ss -ltnp | grep $PORT"
  else
    echo "Watcharr is not running."
  fi
fi
