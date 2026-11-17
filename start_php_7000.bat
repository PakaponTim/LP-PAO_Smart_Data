@echo off
title LP-PAO Smart Data - PHP + Socket.IO Server (Port 7000)
cd /d "%~dp0"

set "PHP_BIN=C:\laragon\bin\php\php-7.2.19-Win32-VC15-x64\php.exe"
if not exist "%PHP_BIN%" set "PHP_BIN=php"

echo ============================================================================
echo   LP-PAO Smart Data (Port 7000) - PHP + Socket.IO + Direct API Collector
echo   URL Public    : http://localhost:7000/public.html
echo   URL Dashboard : http://localhost:7000/
echo   URL Control   : http://localhost:7000/control.html
echo   Isolated strictly on Port 7000 (Database: lp_pao_smart_data)
echo ============================================================================

echo [1/2] Syncing any offline snapshots collected by GitHub Actions into MySQL (lp_pao_smart_data)...
"%PHP_BIN%" php_server\github_sync_to_mysql.php

echo [2/2] Starting Smart Sleep Scheduler + PHP Server on http://127.0.0.1:7000 ...
start /B "" "%PHP_BIN%" php_server\scheduler.php
"%PHP_BIN%" -S 127.0.0.1:7000 php_server\router.php
