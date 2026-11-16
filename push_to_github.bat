@echo off
title Push Water_System2 to GitHub
cd /d "%~dp0"

set "GIT_BIN=C:\laragon\bin\git\bin\git.exe"
if not exist "%GIT_BIN%" set "GIT_BIN=git"

echo ============================================================================
echo   Pushing Water_System2 to GitHub:
echo   https://github.com/PakaponTim/Water_System2.git
echo   (Please complete GitHub login if a window or prompt appears)
echo ============================================================================
echo.

"%GIT_BIN%" push -u origin main

echo.
echo ============================================================================
echo   Done! Press any key to close this window.
echo ============================================================================
pause
