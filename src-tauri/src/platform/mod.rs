//! Native OS boundaries. Chat protocol, previews and window state stay shared.
pub(crate) mod files;
// Retained for the disabled ChatGPT integration.
#[allow(dead_code)]
pub(crate) mod app_tools;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "macos")]
pub(crate) use macos::{background, browser_context, clipboard, process, shell, transport, window};
#[cfg(target_os = "windows")]
pub(crate) use windows::{
    background, browser_context, clipboard, process, shell, transport, window,
};
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
compile_error!("CodexFloat currently targets Windows and macOS.");

use tauri::Manager;
pub fn initialize(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(window) = app.get_webview_window("main") {
        #[cfg(target_os = "macos")]
        {
            self::window::initialize(&window).map_err(std::io::Error::other)?;
            self::window::install_menu(app)?;
        }
        app.manage(background::initialize(&window));
        #[cfg(target_os = "windows")]
        windows::caption::install(&window)?;
    }
    Ok(())
}
pub fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    self::window::on_event(window, event);
}
