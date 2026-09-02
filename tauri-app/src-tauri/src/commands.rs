//! Tauri command handlers - the IPC surface the frontend calls via `invoke()`.
//!
//! This is notably simpler than the Electron app's equivalent: there, the mic stream lived
//! inside the HUD window's own JS (the only place with a `getUserMedia` call), so the
//! Control Center had to relay actions like calibration through the HUD via extra IPC hops.
//! Here the audio engine is global Rust state (`app.manage(AudioEngine::new())`), reachable
//! identically from any window's command invocations - no window-ownership indirection
//! needed for anything audio-related.

use crate::audio::{AudioEngine, DeviceInfo, Levels, NoiseFloorResult};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartResult {
    pub channel_count: u16,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusPayload {
    pub connected: bool,
    pub device_id: Option<String>,
    pub channel_index: Option<usize>,
    pub channel_count: Option<u16>,
    pub error: Option<String>,
}

fn emit_status(app: &AppHandle, status: StatusPayload) {
    let _ = app.emit("status-update", status);
}

#[tauri::command]
pub fn list_devices() -> Result<Vec<DeviceInfo>, String> {
    AudioEngine::list_devices()
}

#[tauri::command]
pub fn start_capture(
    app: AppHandle,
    engine: State<AudioEngine>,
    device_id: String,
    channel_index: usize,
) -> Result<StartResult, String> {
    match engine.start(device_id.clone(), channel_index) {
        Ok(channel_count) => {
            emit_status(
                &app,
                StatusPayload {
                    connected: true,
                    device_id: Some(device_id),
                    channel_index: Some(channel_index),
                    channel_count: Some(channel_count),
                    error: None,
                },
            );
            Ok(StartResult { channel_count })
        }
        Err(err) => {
            emit_status(
                &app,
                StatusPayload {
                    connected: false,
                    device_id: None,
                    channel_index: None,
                    channel_count: None,
                    error: Some(err.clone()),
                },
            );
            Err(err)
        }
    }
}

#[tauri::command]
pub fn select_channel(
    app: AppHandle,
    engine: State<AudioEngine>,
    channel_index: usize,
) -> Result<(), String> {
    engine.set_channel(channel_index)?;
    emit_status(
        &app,
        StatusPayload {
            connected: engine.is_running(),
            device_id: None,
            channel_index: Some(channel_index),
            channel_count: Some(engine.granted_channel_count()),
            error: None,
        },
    );
    Ok(())
}

#[tauri::command]
pub fn stop_capture(app: AppHandle, engine: State<AudioEngine>) -> Result<(), String> {
    engine.stop()?;
    emit_status(
        &app,
        StatusPayload { connected: false, device_id: None, channel_index: None, channel_count: None, error: None },
    );
    Ok(())
}

#[tauri::command]
pub fn get_levels(engine: State<AudioEngine>) -> Levels {
    engine.levels()
}

/// Lets a window that opens after capture already started (e.g. Control Center, opened
/// after the HUD auto-connected on launch) sync to current state immediately rather than
/// waiting for the next status-update event.
#[tauri::command]
pub fn get_status(engine: State<AudioEngine>) -> StatusPayload {
    match engine.current_selection() {
        Some(sel) if engine.is_running() => StatusPayload {
            connected: true,
            device_id: Some(sel.device_id),
            channel_index: Some(sel.channel_index),
            channel_count: Some(engine.granted_channel_count()),
            error: None,
        },
        _ => StatusPayload { connected: false, device_id: None, channel_index: None, channel_count: None, error: None },
    }
}

/// Runs calibration, shows a native notification, and emits `calibration-result` to every
/// window. Shared by the `run_calibration` command, the tray menu item, and the global
/// hotkey, so every trigger source behaves identically regardless of which window (if any)
/// initiated it - matching this app's Electron predecessor, where all three paths funneled
/// through one function for exactly this reason.
///
/// Blocking (sleeps for ~2.5s while sampling) - Tauri runs `async fn` commands on a
/// blocking-friendly executor thread by default, so this is safe to just call directly
/// rather than needing an explicit spawn_blocking.
pub async fn run_calibration_and_notify(app: &AppHandle, engine: &AudioEngine) -> Result<NoiseFloorResult, String> {
    let result = engine.run_calibration();

    let body = match &result {
        Ok(r) => format!(
            "Noise floor {:.1} dB - suggested gate {:.1} dB.",
            r.noise_floor_db, r.suggested_gate_threshold_db
        ),
        Err(err) => format!("Calibration failed: {err}"),
    };
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification().builder().title("Mic Level HUD").body(body).show();

    let payload = match &result {
        Ok(r) => serde_json::json!({ "ok": true, "result": r }),
        Err(err) => serde_json::json!({ "ok": false, "error": err }),
    };
    let _ = app.emit("calibration-result", payload);

    result
}

#[tauri::command]
pub async fn run_calibration(app: AppHandle, engine: State<'_, AudioEngine>) -> Result<NoiseFloorResult, String> {
    run_calibration_and_notify(&app, &engine).await
}

/// "control" is declared visible in tauri.conf.json, same as "hud" - both windows get their
/// WebView2 controller created eagerly at startup, on the main thread, by Tauri's own
/// bootstrap. No lazy/hidden-then-shown choreography: earlier attempts at that (visible:
/// false, or an eager-create-then-hide dance in .setup()) reliably left this window with
/// native chrome but no working webview inside, confirmed on real Windows hardware via
/// WebView2's own remote-debugging endpoint. This command just shows/focuses a window that
/// was already fully alive since launch.
#[tauri::command]
pub fn open_control_center(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("control").ok_or("control window not found")?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_hud_always_on_top(app: AppHandle, value: bool) -> Result<(), String> {
    let window = app.get_webview_window("hud").ok_or("HUD window not found")?;
    window.set_always_on_top(value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn resize_hud(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    let window = app.get_webview_window("hud").ok_or("HUD window not found")?;
    window
        .set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}
