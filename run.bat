@echo off
REM Windows launcher: creates a local virtual environment on first run, builds the web UI if it's missing, then starts the app.
cd /d "%~dp0"
if not exist .venv (
  echo First run: setting up ^(takes a minute^)...
  py -3 -m venv .venv 2>nul || python -m venv .venv
  .venv\Scripts\python -m pip install -q --upgrade pip
  .venv\Scripts\pip install -q -r requirements.txt
)
if not exist frontend\dist\index.html (
  where npm >nul 2>nul || (
    echo The web UI needs Node.js 20+ to build once. Install it from https://nodejs.org, then run this again.
    pause
    exit /b 1
  )
  echo Building the web UI...
  pushd frontend
  if not exist node_modules call npm install --no-audit --no-fund --loglevel=error
  call npm run build --silent
  popd
)
.venv\Scripts\python app.py %*
pause
