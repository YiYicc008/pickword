@echo off
chcp 65001 >nul
setlocal
title 词汇 · 电子英语单词本

cd /d "%~dp0"

set "PY="
where python >nul 2>nul && set "PY=python"
if not defined PY (
  where py >nul 2>nul && set "PY=py -3"
)

if not defined PY (
  echo.
  echo   [提示] 没有找到 Python。
  echo   请先安装 Python 3（https://www.python.org/downloads/ 安装时勾选 Add to PATH），
  echo   或者把整个文件夹放到任意静态服务器上。
  echo.
  pause
  exit /b 1
)

%PY% serve.py %1
echo.
pause
