use super::{background, caption, custom_blur, desktop_acrylic};
use tauri::{Manager, WebviewWindow, Window, WindowEvent};
use windows_sys::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_BORDER_COLOR};

pub fn border(window: &WebviewWindow, compact: bool) {
    if let Ok(hwnd) = window.hwnd() {
        let color = if compact {
            0xfffffffeu32
        } else {
            0xffffffffu32
        };
        unsafe {
            let _ = DwmSetWindowAttribute(
                hwnd.0,
                DWMWA_BORDER_COLOR as u32,
                &color as *const _ as _,
                4,
            );
        }
    }
}
pub fn prepare_compact(
    window: &WebviewWindow,
    compact: bool,
    width: u32,
    height: u32,
    scale: f64,
) -> tauri::Result<()> {
    if compact {
        if let Ok(hwnd) = window.hwnd() {
            desktop_acrylic::suspend(hwnd);
        }
    }
    window.set_decorations(!compact)?;
    if window
        .state::<background::BackdropStatus>()
        .title_bar_height
        .is_some()
    {
        desktop_acrylic::set_window_frame(window.hwnd()?, !compact)
            .map_err(|error| tauri::Error::Anyhow(error.into()))?;
    }
    custom_blur::set_compact(compact, width, height, scale);
    if compact {
        if let Ok(hwnd) = window.hwnd() {
            background::disable_accent(hwnd.0);
            custom_blur::set_visible(false);
        }
    }
    Ok(())
}
pub fn finish_restore(window: &WebviewWindow) {
    if let Ok(hwnd) = window.hwnd() {
        let status = window.state::<background::BackdropStatus>();
        if status.controller
            && desktop_acrylic::install(
                hwnd,
                window
                    .theme()
                    .is_ok_and(|theme| theme == tauri::Theme::Dark),
            )
        {
            caption::refresh(hwnd.0);
            return;
        }
        if custom_blur::active() {
            background::set_system_acrylic(hwnd.0, status.system_acrylic);
            caption::refresh(hwnd.0);
        } else {
            background::apply_acrylic(hwnd.0);
        }
    }
}
pub fn on_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::ThemeChanged(theme) = event {
        desktop_acrylic::update_theme(*theme == tauri::Theme::Dark);
        if let Ok(hwnd) = window.hwnd() {
            caption::refresh(hwnd.0);
        }
    }
    if let WindowEvent::Resized(size) = event {
        custom_blur::resize(
            size.width,
            size.height,
            window.scale_factor().unwrap_or(1.0),
        );
    }
    if matches!(event, WindowEvent::Destroyed) {
        if let Ok(hwnd) = window.hwnd() {
            desktop_acrylic::suspend(hwnd);
        }
        custom_blur::clear();
        desktop_acrylic::clear_custom_title_bar();
    }
    if matches!(event, WindowEvent::Focused(_))
        && !custom_blur::active()
        && !crate::services::mini_mode::is_compact(window.app_handle())
    {
        if let Some(status) = window
            .app_handle()
            .try_state::<background::BackdropStatus>()
        {
            if status.controller {
                return;
            }
            if let Ok(hwnd) = window.hwnd() {
                status.legacy.store(
                    background::apply_acrylic(hwnd.0),
                    std::sync::atomic::Ordering::Relaxed,
                );
            }
        }
    }
}
