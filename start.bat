@echo off
setlocal
title Pickword - English Wordbook
cd /d "%~dp0"

set "PY="
where python >nul 2>nul && set "PY=python"
if not defined PY (
  where py >nul 2>nul && set "PY=py -3"
)
if not defined PY (
  where python3 >nul 2>nul && set "PY=python3"
)

if not defined PY (
  echo.
  echo   [ERROR] Python 3 was not found on this computer.
  echo.
  echo   Install Python 3 from https://www.python.org/downloads/
  echo   and tick "Add python.exe to PATH" during setup, then run this file again.
  echo.
  pause
  exit /b 1
)

%PY% serve.py %1
echo.
pause
