@echo off
title Push Water_System2 to GitHub
cd /d "%~dp0"

set "GIT_BIN=C:\laragon\bin\git\bin\git.exe"
if not exist "%GIT_BIN%" set "GIT_BIN=git"

echo ============================================================================
echo   Pushing Water_System2 to GitHub:
echo   https://github.com/PakaponTim/Water_System2.git
echo   (Please complete GitHub login / Token prompt if a window appears)
echo ============================================================================
echo.

echo [1/3] Checking uncommitted working tree changes...
"%GIT_BIN%" status --short
echo.

echo [2/3] Syncing latest remote snapshots (git pull --rebase --autostash origin main)...
"%GIT_BIN%" pull --rebase --autostash origin main
if errorlevel 1 (
    echo.
    echo [ERROR] git pull --rebase failed. Please inspect conflicts or commit your changes first.
    pause
    exit /b 1
)
echo.

echo [3/3] Pushing local commits to GitHub (origin/main)...
"%GIT_BIN%" push -u origin main
if errorlevel 1 (
    echo.
    echo [ERROR] git push failed. Check GitHub Token/Login or uncommitted changes above.
    pause
    exit /b 1
)

echo.
echo ============================================================================
echo   Push Completed! Opening/refreshing GitHub Actions can now run clean.
echo ============================================================================
pause
