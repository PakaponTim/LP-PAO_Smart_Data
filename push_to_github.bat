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

echo [1/4] Checking uncommitted working tree and secret/runtime guard...
"%GIT_BIN%" status --short
"%GIT_BIN%" status --porcelain | findstr /R /I "\.env$ db_config\.json agency_api_keys\.json notification_secrets\.json \.sql\.gz runtime/" >nul
if %errorlevel%==0 (
    echo.
    echo [SECURITY ABORT] Detected secret or runtime file in Git working tree!
    echo Please remove or gitignore .env / runtime / db_config.json / agency_api_keys.json before pushing.
    pause
    exit /b 1
)
"%GIT_BIN%" grep -n -E "ws2_ag_[a-f0-9]{16,}" -- ":!tests/*" >nul 2>&1
if %errorlevel%==0 (
    echo.
    echo [SECURITY ABORT] Detected plaintext Agency API Key inside tracked files!
    pause
    exit /b 1
)
echo.

echo [2/4] Syncing latest remote snapshots (git pull --rebase --autostash origin main)...
"%GIT_BIN%" pull --rebase --autostash origin main
if errorlevel 1 (
    echo.
    echo [ERROR] git pull --rebase failed. Please inspect conflicts or commit your changes first.
    pause
    exit /b 1
)
echo.

echo [3/4] Checking PHP lint if Laragon PHP is available...
if exist "C:\laragon\bin\php\php-7.2.19-Win32-VC15-x64\php.exe" (
    "C:\laragon\bin\php\php-7.2.19-Win32-VC15-x64\php.exe" -l php_server\security.php >nul
    if errorlevel 1 (
        echo [ERROR] PHP syntax error detected! Aborting push.
        pause
        exit /b 1
    )
)
echo.

echo [4/4] Pushing local commits to GitHub (origin/main)...
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
