mod audio;
mod commands;
mod dsp;

use audio::AudioEngine;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const LEVEL_EMIT_INTERVAL_MS: u64 = 33; // ~30Hz, matching the Electron app's cadence
const CALIBRATION_HOTKEY_MODS: Modifiers = Modifiers::CONTROL.union(Modifiers::ALT);
const CALIBRATION_HOTKEY_CODE: Code = Code::KeyN;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    let calibration_shortcut = Shortcut::new(Some(CALIBRATION_HOTKEY_MODS), CALIBRATION_HOTKEY_CODE);
                    if shortcut == &calibration_shortcut && event.state() == ShortcutState::Pressed {
                        run_calibration_with_notification(app.clone());
                    }
                })
                .build(),
        )
        .manage(AudioEngine::new())
        .invoke_handler(tauri::generate_handler![
            commands::list_devices,
            commands::start_capture,
            commands::select_channel,
            commands::stop_capture,
            commands::get_levels,
            commands::get_status,
            commands::run_calibration,
            commands::open_control_center,
            commands::set_hud_always_on_top,
            commands::resize_hud,
            commands::quit_app,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            let calibration_shortcut = Shortcut::new(Some(CALIBRATION_HOTKEY_MODS), CALIBRATION_HOTKEY_CODE);
            if let Err(err) = app.global_shortcut().register(calibration_shortcut) {
                eprintln!("[hotkey] failed to register Ctrl+Alt+N: {err}");
            }

            setup_tray(app)?;
            spawn_level_emitter(handle);

            Ok(())
        })
        .on_window_event(|window, event| {
            // Keep the app resident in the tray when the HUD is closed rather than quitting -
            // this is a background utility, not a document window.
            if window.label() == "hud" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let show_hide = MenuItem::with_id(app, "show_hide", "Show/Hide HUD", true, None::<&str>)?;
    let open_control = MenuItem::with_id(app, "open_control", "Open Control Center", true, None::<&str>)?;
    let calibrate = MenuItem::with_id(app, "calibrate", "Run Noise Floor Check", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;

    let menu = Menu::with_items(app, &[&show_hide, &open_control, &separator, &calibrate, &separator, &quit])?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("default window icon".into()))?;

    TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show_hide" => {
                if let Some(window) = app.get_webview_window("hud") {
                    let visible = window.is_visible().unwrap_or(false);
                    let _ = if visible { window.hide() } else { window.show() };
                }
            }
            "open_control" => {
                let _ = commands::open_control_center(app.clone());
            }
            "calibrate" => run_calibration_with_notification(app.clone()),
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

/// Entry point for the tray menu item and the global hotkey - the `run_calibration` Tauri
/// command handles the case where a window itself invoked it. Both paths converge on
/// `commands::run_calibration_and_notify` so behavior is identical either way.
fn run_calibration_with_notification(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let engine = app.state::<AudioEngine>();
        let _ = commands::run_calibration_and_notify(&app, &engine).await;
    });
}

fn spawn_level_emitter(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_millis(LEVEL_EMIT_INTERVAL_MS));
        loop {
            interval.tick().await;
            let engine = app.state::<AudioEngine>();
            let levels = engine.levels();
            let _ = app.emit("level-update", levels);
        }
    });
}
