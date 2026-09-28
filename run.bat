@echo off
REM Windows launcher: creates a local virtual environment on first run, then starts the app.
cd /d "%~dp0"
if not exist .venv (
  echo First run: setting up ^(takes a minute^)...
  py -3 -m venv .venv 2>nul || python -m venv .venv
  .venv\Scripts\python -m pip install -q --upgrade pip
  .venv\Scripts\pip install -q -r requirements.txt
)
.venv\Scripts\python app.py %*
pause
