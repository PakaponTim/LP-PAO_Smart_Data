@echo off
title Water_System2 - PHP + Socket.IO Server (Port 7000)
cd /d "%~dp0"

set "PHP_BIN=C:\laragon\bin\php\php-7.2.19-Win32-VC15-x64\php.exe"
if not exist "%PHP_BIN%" set "PHP_BIN=php"

echo ============================================================================
echo   Water_System2 (Port 7000) - PHP + Socket.IO + Direct API Collector
echo   URL Dashboard : http://localhost:7000/
echo   URL Control   : http://localhost:7000/control.html
echo   Isolated strictly on Port 7000 (Database: water_system2)
echo ============================================================================

echo [1/2] Syncing any offline snapshots collected by GitHub Actions into MySQL (water_system2)...
"%PHP_BIN%" php_server\github_sync_to_mysql.php

echo [2/2] Starting Smart Sleep Scheduler + PHP Server on http://127.0.0.1:7000 ...
start /B "" "%PHP_BIN%" php_server\scheduler.php
"%PHP_BIN%" -S 127.0.0.1:7000 php_server\router.php
