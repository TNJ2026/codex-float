use super::{background, custom_blur};
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
pub fn prepare_compact(window: &WebviewWindow, compact: bool, width: u32, height: u32, scale: f64) {
    custom_blur::set_compact(compact, width, height, scale);
    if !custom_blur::active() {
        if let Ok(hwnd) = window.hwnd() {
            if compact {
                background::disable_accent(hwnd.0);
            }
        }
    }
}
pub fn finish_restore(window: &WebviewWindow) {
    if !custom_blur::active() {
        if let Ok(hwnd) = window.hwnd() {
            background::apply_acrylic(hwnd.0);
        }
    }
}
pub fn on_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::Resized(size) = event {
        custom_blur::resize(
            size.width,
            size.height,
            window.scale_factor().unwrap_or(1.0),
        );
    }
    if matches!(event, WindowEvent::Destroyed) {
        custom_blur::clear();
    }
    if matches!(event, WindowEvent::Focused(_))
        && !custom_blur::active()
        && !crate::services::mini_mode::is_compact(window.app_handle())
    {
        if let Some(status) = window
            .app_handle()
            .try_state::<background::BackdropStatus>()
        {
            if let Ok(hwnd) = window.hwnd() {
                status.legacy.store(
                    background::apply_acrylic(hwnd.0),
                    std::sync::atomic::Ordering::Relaxed,
                );
            }
        }
    }
}
