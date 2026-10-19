@echo off
setlocal
cd /d "%~dp0"

set "NODE_EXE="
for /f "delims=" %%N in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%N"

if not defined NODE_EXE if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if not defined NODE_EXE (
  echo Could not find Node.js 18 or newer.
  echo Install Node.js, then double-click this file again.
  echo Download: https://nodejs.org/
  pause
  exit /b 1
)

echo Starting the Philosophy Game room service...
echo Your browser will open automatically. Keep this window open while playing.
"%NODE_EXE%" server.js
echo.
echo The room service has stopped.
pause
