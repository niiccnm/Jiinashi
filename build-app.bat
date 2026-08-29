@echo off
setlocal

cd /d "%~dp0"

echo Building the Jiinashi Windows installer...
call npm run dist
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if %EXIT_CODE% neq 0 (
    echo Installer build failed.
) else (
    echo Installer build completed successfully.
    echo Output: %~dp0dist-electron\release
)

pause
exit /b %EXIT_CODE%
