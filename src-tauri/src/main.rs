// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

#[derive(Serialize)]
struct DesktopEnvInfo {
    os: String,
    arch: String,
    app_version: String,
    backup_dir: String,
}

/// Resolves and creates the persistent native backup directory in Windows AppData (`%APPDATA%\com.billaudit.pro\backups`)
fn resolve_backup_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let base_dir = app_handle
        .path_resolver()
        .app_data_dir()
        .ok_or_else(|| "Could not resolve application data directory".to_string())?;
    let backup_dir = base_dir.join("backups");
    if !backup_dir.exists() {
        fs::create_dir_all(&backup_dir).map_err(|e| format!("Failed to create backup dir: {}", e))?;
    }
    Ok(backup_dir)
}

/// Native Rust command to persist custody bills & state snapshots directly to the Windows disk.
/// Ensures zero data loss even if browser localStorage is cleared.
#[tauri::command]
fn save_local_backup(app_handle: AppHandle, filename: String, content: String) -> Result<String, String> {
    let safe_name: String = filename
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-' || *c == '.')
        .collect();
    if safe_name.is_empty() {
        return Err("Invalid backup filename".to_string());
    }
    let dir = resolve_backup_dir(&app_handle)?;
    let file_path = dir.join(safe_name);
    fs::write(&file_path, content.as_bytes())
        .map_err(|e| format!("Failed to write backup file: {}", e))?;
    Ok(file_path.to_string_lossy().to_string())
}

/// Native Rust command to load a previously saved JSON snapshot from the Windows disk.
#[tauri::command]
fn load_local_backup(app_handle: AppHandle, filename: String) -> Result<String, String> {
    let safe_name: String = filename
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-' || *c == '.')
        .collect();
    let dir = resolve_backup_dir(&app_handle)?;
    let file_path = dir.join(safe_name);
    if !file_path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&file_path).map_err(|e| format!("Failed to read backup file: {}", e))
}

/// Native Rust HTTP GET command to fetch Google Sheets GViz / Apps Script data directly from Rust
/// without browser CORS restrictions.
#[tauri::command]
fn fetch_url_native(url: String) -> Result<String, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("HTTP client init error: {}", e))?;

    let resp = client
        .get(&url)
        .header("User-Agent", "BillAuditPro-RustDesktop/1.0")
        .send()
        .map_err(|e| format!("Network request failed: {}", e))?;

    resp.text().map_err(|e| format!("Failed to read response body: {}", e))
}

/// Returns desktop environment metadata to the frontend UI.
#[tauri::command]
fn get_desktop_env_info(app_handle: AppHandle) -> Result<DesktopEnvInfo, String> {
    let dir = resolve_backup_dir(&app_handle).unwrap_or_else(|_| PathBuf::from(""));
    Ok(DesktopEnvInfo {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        backup_dir: dir.to_string_lossy().to_string(),
    })
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            save_local_backup,
            load_local_backup,
            fetch_url_native,
            get_desktop_env_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running BillAudit Pro Rust desktop application");
}
