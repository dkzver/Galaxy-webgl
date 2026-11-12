@echo off
chcp 65001 >nul
setlocal EnableExtensions
title GalaxyDemo - сервер

rem Всегда работаем из папки проекта, даже если .bat вызван из другого каталога
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto no_node

if not exist "server.js" goto no_project

if not defined PORT set "PORT=3000"

echo.
echo   GalaxyDemo — космический полёт на WebGL
echo   Браузер откроется сам. Адрес печатает сервер ниже.
echo   Остановка: Ctrl+C в этом окне
echo.

node server.js --open
set "EXITCODE=%ERRORLEVEL%"

echo.
if not "%EXITCODE%"=="0" echo   Сервер завершён с кодом %EXITCODE%.
echo   Нажмите любую клавишу, чтобы закрыть окно.
pause >nul
exit /b %EXITCODE%

:no_project
echo.
echo   [ОШИБКА] Рядом с этим файлом нет server.js.
echo   Запускайте start-server.bat из корня проекта GalaxyDemo.
echo.
pause
exit /b 1

:no_node
echo.
echo   [ОШИБКА] Node.js не найден в PATH.
echo   Установите Node.js 18 или новее: https://nodejs.org/
echo.
pause
exit /b 1
