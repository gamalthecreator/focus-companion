@echo off
cd /d "%~dp0"

if not exist "node_modules\" (
    echo Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo Failed to install dependencies.
        pause
        exit /b %errorlevel%
    )
)

if not exist "dist\index.html" (
    echo Building frontend...
    call npm run build
    if %errorlevel% neq 0 (
        echo Failed to build frontend.
        pause
        exit /b %errorlevel%
    )
)

echo Starting Focus Companion...
start "" /B npm start >nul 2>&1
