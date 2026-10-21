@echo off
title BillAudit Pro - Rust Windows Installer Builder (.exe & .msi)
echo ============================================================================
echo   BILLAUDIT PRO - NATIVE RUST WINDOWS APP BUILDER
echo ============================================================================
echo.

where cargo >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Rust / Cargo is not installed on this Windows PC.
    echo Please install Rust from https://rustup.rs/ and Visual Studio C++ Build Tools,
    echo then re-run this script.
    pause
    exit /b 1
)

where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not installed on this Windows PC.
    echo Please install Node.js LTS from https://nodejs.org/ and re-run this script.
    pause
    exit /b 1
)

echo [1/3] Preparing frontend distribution files in dist/...
node scripts/prepare-dist.js
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to prepare dist/ folder.
    pause
    exit /b 1
)

echo [2/3] Installing Tauri CLI if needed...
call npm install

echo [3/3] Compiling Native Rust Windows Installer (.exe and .msi)...
call npx tauri build

if %ERRORLEVEL% equ 0 (
    echo.
    echo ============================================================================
    echo   BUILD SUCCESSFUL!
    echo   1. NSIS Setup Installer (.exe):
    echo      src-tauri\target\release\bundle\nsis\BillAudit Pro_1.0.0_x64-setup.exe
    echo   2. Windows MSI Installer (.msi):
    echo      src-tauri\target\release\bundle\msi\BillAudit Pro_1.0.0_x64_en-US.msi
    echo   3. Standalone Portable Executable (.exe):
    echo      src-tauri\target\release\billaudit-pro.exe
    echo ============================================================================
    explorer "src-tauri\target\release\bundle\nsis"
) else (
    echo.
    echo [ERROR] Rust Tauri build failed. Check the output above for details.
)
pause
