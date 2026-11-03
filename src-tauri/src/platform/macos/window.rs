use tauri::{WebviewWindow, Window, WindowEvent};

pub fn border(_window: &WebviewWindow, _compact: bool) {}
pub fn prepare_compact(
    window: &WebviewWindow,
    compact: bool,
    _width: u32,
    _height: u32,
    _scale: f64,
) {
    let _ = super::background::apply(window, if compact { 26.0 } else { 8.0 });
}
pub fn on_event(_window: &Window, _event: &WindowEvent) {}
pub fn finish_restore(_window: &WebviewWindow) {}
