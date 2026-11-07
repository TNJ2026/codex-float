use super::{background, caption, custom_blur, desktop_acrylic};
use tauri::{Manager, WebviewWindow, Window, WindowEvent};
use windows_sys::Win32::{
    Foundation::{HWND, RECT},
    Graphics::{
        Dwm::{DwmSetWindowAttribute, DWMWA_BORDER_COLOR},
        Gdi::{CreateEllipticRgn, DeleteObject, GetWindowRgnBox, SetWindowRgn},
    },
};

fn needs_compact_region(status: &background::BackdropStatus) -> bool {
    // The custom compositor already clips its blur inside the antialiased SVG rim.
    !status.custom || status.system_acrylic
}

fn set_compact_region(hwnd: HWND, compact: bool, width: u32, height: u32) -> tauri::Result<()> {
    unsafe {
        let region = if compact {
            let mut bounds = RECT::default();
            if GetWindowRgnBox(hwnd, &mut bounds) != 0
                && bounds.right == width as i32
                && bounds.bottom == height as i32
            {
                return Ok(());
            }
            let region = CreateEllipticRgn(0, 0, width as i32, height as i32);
            if region.is_null() {
                return Err(std::io::Error::other("无法创建悬浮球圆形区域").into());
            }
            region
        } else {
            std::ptr::null_mut()
        };
        if SetWindowRgn(hwnd, region, 1) == 0 {
            if !region.is_null() {
                DeleteObject(region);
            }
            return Err(std::io::Error::other("无法更新悬浮球窗口区域").into());
        }
        // Windows owns the region after a successful SetWindowRgn.
    }
    Ok(())
}

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
    let hwnd = window.hwnd()?;
    let backdrop = window.state::<background::BackdropStatus>();
    if needs_compact_region(&backdrop) {
        set_compact_region(hwnd.0, compact, width, height)?;
    }
    window.set_decorations(!compact)?;
    if backdrop.title_bar_height.is_some() {
        desktop_acrylic::set_window_frame(hwnd, !compact)
            .map_err(|error| tauri::Error::Anyhow(error.into()))?;
    }
    custom_blur::set_compact(compact, width, height, scale);
    Ok(())
}
pub fn finish_restore(window: &WebviewWindow) {
    if let Ok(hwnd) = window.hwnd() {
        caption::refresh(hwnd.0);
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
        if size.width > 0
            && size.height > 0
            && crate::services::mini_mode::is_compact(window.app_handle())
            && window
                .try_state::<background::BackdropStatus>()
                .is_some_and(|backdrop| needs_compact_region(&backdrop))
        {
            if let Ok(hwnd) = window.hwnd() {
                let _ = set_compact_region(hwnd.0, true, size.width, size.height);
            }
        }
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
