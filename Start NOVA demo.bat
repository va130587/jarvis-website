@echo off
rem Double-click this file on Windows to start the NOVA demo and open it in your browser.
title NOVA demo
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed yet. Go to https://nodejs.org, download the "LTS" version,
  echo   install it, then double-click this file again.
  echo.
  pause
  exit /b 1
)
echo Starting NOVA... your browser will open in a few seconds.
echo Sign in with:  demo@nova.local
echo Keep this window open while you use NOVA. Close it to stop NOVA.
echo.
start "" cmd /c "timeout /t 4 /nobreak >nul & start http://127.0.0.1:8788"
node scripts\demo.js
pause
