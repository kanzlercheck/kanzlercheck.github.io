@echo off
setlocal
cd /d "%~dp0"
title Update polls from dawum.de
set "PY="
py -3 --version >nul 2>nul && set "PY=py -3"
if not defined PY python --version >nul 2>nul && set "PY=python"
if not defined PY (
  echo Python 3 was not found.
  echo Install it from https://www.python.org/downloads/  ^(tick "Add python.exe to PATH"^)
  echo or run:  winget install Python.Python.3.12
  echo Then double-click this file again.
  pause
  exit /b 1
)
echo.
%PY% "%~dp0update_data.py" %*
echo.
if errorlevel 1 (echo Something went wrong - see the message above.) else (echo All data is up to date.)
pause
