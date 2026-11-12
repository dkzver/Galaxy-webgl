@echo off
chcp 65001 >nul
setlocal EnableExtensions
title GalaxyDemo - остановка сервера

cd /d "%~dp0"

echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\stop-server.ps1"

echo.
echo   Нажмите любую клавишу, чтобы закрыть окно.
pause >nul
