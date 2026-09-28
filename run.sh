#!/usr/bin/env bash
# macOS / Linux launcher: creates a local virtual environment on first run, then starts the app.
set -e
cd "$(dirname "$0")"
PY=$(command -v python3 || command -v python)
if [ ! -d .venv ]; then
  echo "First run: setting up (takes a minute)…"
  "$PY" -m venv .venv
  .venv/bin/pip install -q --upgrade pip
  .venv/bin/pip install -q -r requirements.txt
fi
exec .venv/bin/python app.py "$@"
