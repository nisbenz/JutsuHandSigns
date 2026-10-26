#!/usr/bin/env bash
# Starts the FastAPI matching backend and the Vite frontend together.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_PY="$ROOT_DIR/.venv/bin/uvicorn"
BACKEND_DIR="$ROOT_DIR/backend"
WEB_DIR="$ROOT_DIR/web"

# Override when something else already uses these, e.g.
#   BACKEND_PORT=8002 make run
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5177}"

# The frontend talks to the backend over these websockets.
export VITE_MATCH_WS_URL="ws://localhost:$BACKEND_PORT/ws/match"
export VITE_JUTSU_WS_URL="ws://localhost:$BACKEND_PORT/ws/jutsu"
export VITE_PVP_WS_URL="ws://localhost:$BACKEND_PORT/ws/pvp"

port_in_use() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

cleanup() {
  echo ""
  echo "Stopping..."
  [[ -n "${BACKEND_PID:-}" ]] && kill "$BACKEND_PID" 2>/dev/null || true
  [[ -n "${FRONTEND_PID:-}" ]] && kill "$FRONTEND_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Free the ports if a previous run left something listening.
if command -v lsof >/dev/null; then
  lsof -ti:"$BACKEND_PORT" -sTCP:LISTEN 2>/dev/null | xargs -r kill || true
  lsof -ti:"$FRONTEND_PORT" -sTCP:LISTEN 2>/dev/null | xargs -r kill || true
  sleep 0.5
fi
if port_in_use "$BACKEND_PORT"; then
  echo "Port $BACKEND_PORT is already in use by another program."
  echo "Stop it, or pick another port:  BACKEND_PORT=8002 make run"
  exit 1
fi

echo "Starting backend on http://localhost:$BACKEND_PORT ..."
(cd "$BACKEND_DIR" && "$VENV_PY" main:app --port "$BACKEND_PORT") &
BACKEND_PID=$!

echo "Waiting for backend to come up..."
until curl -sf "http://localhost:$BACKEND_PORT/health" >/dev/null 2>&1; do
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "Backend failed to start (see the error above)."
    exit 1
  fi
  sleep 0.5
done
echo "Backend ready."

echo "Starting frontend on http://localhost:$FRONTEND_PORT ..."
(cd "$WEB_DIR" && npm run dev -- --port "$FRONTEND_PORT") &
FRONTEND_PID=$!

echo ""
echo "Which Shinobi Are You? is running:"
echo "  Frontend: http://localhost:$FRONTEND_PORT"
echo "  Backend:  http://localhost:$BACKEND_PORT"
echo ""
echo "Press Ctrl+C to stop both."

wait
