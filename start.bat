@echo off
title Elden Ring - Ultimate Region Tracker
cd /d "%~dp0"

REM --- find Python (py launcher preferred, then python) ---
set "PYCMD="
where py >nul 2>nul && set "PYCMD=py -3"
if not defined PYCMD (
  where python >nul 2>nul && set "PYCMD=python"
)

if not defined PYCMD (
  echo.
  echo   Python was not found on this PC.
  echo   Install it from https://www.python.org/downloads/
  echo   ^(tick "Add Python to PATH" during setup^), then double-click this file again.
  echo.
  pause
  exit /b
)

echo.
echo   Elden Ring - Ultimate Region Tracker
echo   ------------------------------------
echo   Opening http://localhost:8000/ in your browser...
echo.
echo   KEEP THIS WINDOW OPEN while you use the tracker.
echo   Close it (or press Ctrl+C) when you're done to stop the server.
echo.

REM open the browser a couple seconds after the server starts
start "" cmd /c "timeout /t 2 >nul & start http://localhost:8000/"

REM start the local web server (this window stays running)
%PYCMD% -m http.server 8000

REM if the server exits/fails (e.g. port already in use), pause so the message is readable
echo.
echo   The server has stopped.
pause
