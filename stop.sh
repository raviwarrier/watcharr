#!/usr/bin/env bash
# Stops Watcharr (macOS and Linux).
#   bash stop.sh
#
# Stops three kinds of process, and only on Watcharr's port (PORT in .env.local):
#   1. The one start.sh started (recorded in .watcharr/app.pid).
#   2. Any Next.js server on the port that runs from this project folder.
#   3. Any other Next.js server on the port, including one owned by another user.
#      Finding these may need sudo, so you may be asked for your password once.
set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(pwd)"
PID_FILE="$ROOT/.watcharr/app.pid"

PORT="$( (grep -E '^PORT=' .env.local 2>/dev/null || true) | tail -1 | cut -d= -f2-)"
PORT="${PORT:-4242}"

# Use sudo for processes owned by other users (not needed when already root).
PRIV=""
if [ "$(id -u)" -ne 0 ]; then PRIV="sudo"; fi

# Stop a process politely, then forcefully if it doesn't exit.
stop_pid() {
  local pid="$1" priv="${2:-}"
  $priv kill -TERM "$pid" 2>/dev/null || true
  for _ in $(seq 1 10); do
    $priv kill -0 "$pid" 2>/dev/null || return 0
    sleep 1
  done
  $priv kill -KILL "$pid" 2>/dev/null || true
}

# PIDs listening on the port, as seen by the current user.
listener_pids() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true
  elif command -v ss >/dev/null 2>&1; then
    ss -ltnpH "sport = :$PORT" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u || true
  fi
}

# PIDs listening on the port, including other users' processes (needs sudo).
privileged_listener_pids() {
  command -v ss >/dev/null 2>&1 || return 0
  $PRIV ss -ltnpH "sport = :$PORT" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u || true
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

port_in_use() {
  if command -v lsof >/dev/null 2>&1 && lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then return 0; fi
  if command -v ss >/dev/null 2>&1 && [ -n "$(ss -ltnH "sport = :$PORT" 2>/dev/null || true)" ]; then return 0; fi
  return 1
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

# 2 and 3. Next.js servers on the port. Watcharr's port is set in .env.local, so a Next.js server
# there is almost always an earlier Watcharr (for example, one started by hand, possibly by another user).
for PID in $(listener_pids); do
  CWD="$(cwd_of "$PID")"
  ARGS="$(ps -o args= -p "$PID" 2>/dev/null || true)"
  if [ "$CWD" = "$ROOT" ] || echo "$ARGS" | grep -qi 'next'; then
    stop_pid "$PID"
    echo "Stopped the Next.js server on port $PORT (PID $PID, folder: ${CWD:-unknown}, command: ${ARGS:-unknown})."
    STOPPED=1
  fi
done

if port_in_use; then
  # Still busy: the owner is probably another user. Ask for sudo to see it.
  for PID in $(privileged_listener_pids); do
    ARGS="$($PRIV ps -o args= -p "$PID" 2>/dev/null || true)"
    if echo "$ARGS" | grep -qi 'next'; then
      stop_pid "$PID" "$PRIV"
      echo "Stopped the Next.js server on port $PORT owned by another user (PID $PID, command: ${ARGS:-unknown})."
      STOPPED=1
    fi
  done
fi

if port_in_use; then
  echo "Port $PORT is still in use by something that doesn't look like Watcharr. Leaving it alone."
  echo "Check it with: sudo ss -ltnp | grep $PORT"
  exit 1
fi

if [ "$STOPPED" -eq 0 ]; then
  echo "Watcharr is not running."
fi
