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

REM start the helper server (it auto-detects your save and opens the browser itself)
%PYCMD% server.py

REM if the server exits/fails, pause so the message is readable
echo.
echo   The server has stopped.
pause
