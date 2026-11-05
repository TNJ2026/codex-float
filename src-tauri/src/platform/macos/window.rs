use objc2::{msg_send, MainThreadMarker};
use objc2_app_kit::{NSView, NSWindow, NSWindowTitleVisibility};
use tauri::{Manager, WebviewWindow, Window, WindowEvent};

pub use super::toolbar::install_menu;
pub fn initialize(window: &WebviewWindow) -> Result<(), String> {
    super::toolbar::install(window)?;
    super::drag::install(window)
}
pub fn titlebar_height(window: &WebviewWindow) -> f64 {
    super::toolbar::height(window)
}

fn native_controls(window: &WebviewWindow, hidden: bool) -> Result<(), String> {
    let _main = MainThreadMarker::new().ok_or("窗口按钮必须在主线程更新")?;
    let pointer = window.ns_window().map_err(|error| error.to_string())?;
    if pointer.is_null() {
        return Err("无法获取原生窗口".into());
    }
    // SAFETY: AppKit owns the standard buttons and their target/actions.
    // It also owns all placement: never move its private titlebar subviews.
    unsafe {
        let native = &*pointer.cast::<NSWindow>();
        native.setTitleVisibility(if hidden {
            NSWindowTitleVisibility::Hidden
        } else {
            NSWindowTitleVisibility::Visible
        });
        for kind in [0_usize, 1, 2] {
            let button: *mut NSView = msg_send![native, standardWindowButton: kind];
            if let Some(button) = button.as_ref() {
                button.setHidden(hidden);
            }
        }
    }
    Ok(())
}
pub fn border(window: &WebviewWindow, compact: bool) {
    let _ = native_controls(window, compact);
}
pub fn prepare_compact(
    window: &WebviewWindow,
    compact: bool,
    _width: u32,
    _height: u32,
    _scale: f64,
) {
    super::toolbar::set_visible(!compact);
    let _ = native_controls(window, compact);
    let _ = super::background::apply(
        window,
        if compact {
            26.0
        } else {
            super::background::CHAT_RADIUS
        },
    );
}
pub fn on_event(window: &Window, event: &WindowEvent) {
    if matches!(event, WindowEvent::Resized(_)) {
        if let Some(handle) = window.app_handle().get_webview_window(window.label()) {
            let compact = crate::services::mini_mode::is_compact(window.app_handle());
            if !handle.is_fullscreen().unwrap_or(false) {
                let _ = native_controls(&handle, compact);
            }
            if !compact {
                super::toolbar::publish_layout(&handle);
            }
        }
    }
}
pub fn finish_restore(window: &WebviewWindow) {
    super::toolbar::set_visible(true);
    let _ = native_controls(window, false);
    super::toolbar::publish_layout(window);
}
