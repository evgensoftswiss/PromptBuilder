@echo off
setlocal
cd /d "%~dp0"
title Prompt Builder

where python.exe >nul 2>nul
if errorlevel 1 (
  echo Python was not found. Install Python or add it to PATH.
  pause
  exit /b 1
)

rem Start the local server in its own minimized console window.
start "Prompt Builder server" /min python.exe -m http.server 3000
timeout /t 2 /nobreak >nul
start "" "http://localhost:3000"
echo Prompt Builder: http://localhost:3000
echo Close the server window to stop the service.
