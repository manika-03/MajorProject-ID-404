@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Follow README.md to create the Python environment first.
  pause
  exit /b 1
)
echo Starting CareVoice. Open http://127.0.0.1:5000 in Chrome.
".venv\Scripts\python.exe" app.py
pause
