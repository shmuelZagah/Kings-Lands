@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Kings Lands - Local Development Server

echo.
echo ========================================
echo   Kings Lands - Local Development
echo ========================================
echo.

set "NODE_DIR=%~dp0tools\node"

rem Use the portable Node only if it is intact. Otherwise use system Node.
if exist "%NODE_DIR%\node.exe" if exist "%NODE_DIR%\npm.cmd" set "PATH=%NODE_DIR%;%PATH%"

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js was not found.
  echo Install the LTS version from https://nodejs.org and run this file again.
  pause
  exit /b 1
)

echo Using Node:
node -v
echo.

if not exist "node_modules\vite\bin\vite.js" (
  echo Installing project dependencies. This is normally needed only once...
  call npm install
  if errorlevel 1 (
    echo.
    echo ERROR: Dependency installation failed. Check your internet connection.
    pause
    exit /b 1
  )
)

echo.
echo Starting the local development server...
echo Chrome will open at http://127.0.0.1:5173
echo Keep this window open while playing or developing.
echo Press Ctrl+C in this window to stop the server.
echo.

set "BROWSER=chrome"
call npm run dev -- --host 127.0.0.1 --port 5173 --strictPort --open
set "EXIT_CODE=%ERRORLEVEL%"
echo.
echo Development server stopped.
if not "%EXIT_CODE%"=="0" echo Vite exited with code %EXIT_CODE%.
pause
exit /b %EXIT_CODE%