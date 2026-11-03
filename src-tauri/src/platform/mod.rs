//! Native OS boundaries. Chat protocol, previews and window state stay shared.
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "macos")]
pub(crate) use macos::{background, process, shell, transport, window};
#[cfg(target_os = "windows")]
pub(crate) use windows::{background, process, shell, transport, window};
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
compile_error!("Codex Float currently targets Windows and macOS.");

use tauri::Manager;
pub fn initialize(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(window) = app.get_webview_window("main") {
        app.manage(background::initialize(&window));
    }
    Ok(())
}
pub fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    self::window::on_event(window, event);
}
