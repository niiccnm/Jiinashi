@echo off
setlocal

cd /d "%~dp0"

echo Starting Jiinashi development server...
call npm run dev
set "EXIT_CODE=%ERRORLEVEL%"

pause
exit /b %EXIT_CODE%