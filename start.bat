@echo off
setlocal
title Pickword - English Wordbook
cd /d "%~dp0"

rem Prefer Node.js (better concurrency), fall back to Python 3.
rem Keep this file ASCII-only: cmd parses batch lines before chcp takes effect,
rem and multi-byte characters in the file can shift following lines.

set "NODE_OK="
where node >nul 2>nul && (
  node --version >nul 2>nul && set "NODE_OK=1"
)

if defined NODE_OK (
  node serve.mjs %1
  if errorlevel 1 goto fallback
  goto done
)

:fallback
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
  echo   [ERROR] Neither Node.js nor Python 3 was found on this computer.
  echo.
  echo   Option A: install Node.js from https://nodejs.org/  (recommended)
  echo   Option B: install Python 3 from https://www.python.org/downloads/
  echo             and tick "Add python.exe to PATH" during setup.
  echo.
  echo   Then run this file again.
  echo.
  pause
  exit /b 1
)

%PY% serve.py %1

:done
echo.
pause
