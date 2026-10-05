#!/usr/bin/env bash
# macOS / Linux launcher: creates a local virtual environment on first run, builds the web UI when it's missing or
# out of date, then starts the app.
set -e
cd "$(dirname "$0")"
PY=$(command -v python3 || command -v python)
if [ ! -d .venv ]; then
  echo "First run: setting up (takes a minute)…"
  "$PY" -m venv .venv
  .venv/bin/pip install -q --upgrade pip
  .venv/bin/pip install -q -r requirements.txt
fi
UI=frontend/dist/index.html
if [ ! -f "$UI" ] || [ -n "$(find frontend/src frontend/index.html frontend/package.json -newer "$UI" 2>/dev/null | head -1)" ]; then
  if command -v npm >/dev/null 2>&1; then
    echo "Building the web UI…"
    (cd frontend && { [ -d node_modules ] || npm install --no-audit --no-fund --loglevel=error; } && npm run build --silent)
  elif [ ! -f "$UI" ]; then
    echo "The web UI needs Node.js 20+ to build once. Install it from https://nodejs.org, then run this again." >&2
    exit 1
  fi
fi
exec .venv/bin/python app.py "$@"
