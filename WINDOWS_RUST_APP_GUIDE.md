# BillAudit Pro — Native Rust (Tauri) Windows Desktop App Guide

This repository includes a complete **Rust (Tauri)** desktop application wrapper (`src-tauri/`) that compiles **BillAudit Pro** into a native, installable **Windows `.exe` (NSIS Setup)** and **`.msi` (Windows Installer)** package (~4 MB) with automatic local disk backups in `%APPDATA%\com.billaudit.pro\backups`.

---

## Option 1: Download the Ready-to-Install `.exe` from GitHub Actions (No Windows Compiler Needed)

Whenever changes are pushed to `main`, the GitHub Actions workflow in [`.github/workflows/build-windows-exe.yml`](.github/workflows/build-windows-exe.yml) automatically spins up a `windows-latest` runner, compiles the Rust binary and Windows installers, and uploads them as an artifact:

1. Open your GitHub repository in the browser and click the **Actions** tab.
2. Select the **Build Windows Rust Desktop Installer (.exe & .msi)** workflow (you can also click **Run workflow** manually at any time).
3. Once the job finishes, scroll down to **Artifacts** and download **`BillAudit-Pro-Windows-Installer`**.
4. Inside the downloaded zip, run:
   - **`BillAudit Pro_1.0.0_x64-setup.exe`** — Standard Windows Setup wizard (creates Desktop & Start Menu shortcuts), or
   - **`BillAudit Pro_1.0.0_x64_en-US.msi`** — Windows MSI package, or
   - **`billaudit-pro.exe`** — Standalone portable executable.

---

## Option 2: Build Locally on a Windows 10 / 11 PC

If you have the code on a Windows PC and want to compile the `.exe` directly:

1. Install **Rust** from [https://rustup.rs/](https://rustup.rs/) (along with the Visual Studio C++ Build Tools workload).
2. Install **Node.js LTS** from [https://nodejs.org/](https://nodejs.org/).
3. Double-click **`build_windows.bat`** in the project root (or run `npm install && npm run build` in Command Prompt / PowerShell).
4. Once compilation finishes, Windows Explorer will automatically open `src-tauri\target\release\bundle\nsis\` containing your installable **`BillAudit Pro_1.0.0_x64-setup.exe`**.

---

## Native Rust Capabilities Included (`src-tauri/src/main.rs`)

- **Automatic Disk Backup (`save_local_backup` & `load_local_backup`)**: Mirrors your active custody bills (`custody_bills_backup.json`) directly to the Windows `%APPDATA%\com.billaudit.pro\backups` folder whenever bills change, protecting your records even if browser cache is cleared.
- **Native Rust HTTP Client (`fetch_url_native`)**: Uses Rust `reqwest` with `rustls-tls` for fast background sheet requests without browser CORS restrictions.
- **Zero-Console Native Window**: Runs as a native Windows GUI subsystem process (`windows_subsystem = "windows"`) at 1440×900 resolution.
