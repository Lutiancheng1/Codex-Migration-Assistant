use base64::Engine;
use serde_json::Value;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;

const SIDECAR_NAME: &str = "codex-desktop-runner";
const SQLJS_WASM_RESOURCE_PATH: &str = "desktop/sql-wasm.wasm";

#[tauri::command]
async fn run_backend_command(app: AppHandle, request: Value) -> Result<Value, String> {
    let payload = base64::engine::general_purpose::STANDARD
        .encode(serde_json::to_vec(&request).map_err(|err| err.to_string())?);
    let mut command = app
        .shell()
        .sidecar(SIDECAR_NAME)
        .map_err(|err| format!("Failed to resolve desktop runner sidecar: {err}"))?;

    if let Ok(resource_dir) = app.path().resource_dir() {
        let wasm_path = resource_dir.join(SQLJS_WASM_RESOURCE_PATH);
        if wasm_path.exists() {
            command = command.env("CODEX_SQLJS_WASM_PATH", wasm_path);
        }
    }

    let output = command
        .arg(payload)
        .output()
        .await
        .map_err(|err| format!("Failed to spawn desktop runner sidecar: {err}"))?;

    let stdout = String::from_utf8(output.stdout).map_err(|err| err.to_string())?;
    if stdout.trim().is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Desktop runner returned empty output. {stderr}"));
    }

    serde_json::from_str(stdout.trim())
        .map_err(|err| format!("Invalid desktop runner response: {err}"))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![run_backend_command])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
