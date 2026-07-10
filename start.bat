@echo off
if not "%1"=="--hidden" (
    powershell -WindowStyle Hidden -NoProfile -Command "Start-Process cmd -ArgumentList '/c \"\"%~f0\" --hidden\"' -WindowStyle Hidden"
    exit /b
)

cd /d "%~dp0"

if not exist "node_modules\" (
    call npm install
    if %errorlevel% neq 0 exit /b %errorlevel%
)

if not exist "dist\index.html" (
    call npm run build
    if %errorlevel% neq 0 exit /b %errorlevel%
)

start "" /B npm start >nul 2>&1
