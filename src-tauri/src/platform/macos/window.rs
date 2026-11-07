use objc2::{msg_send, AnyThread, MainThreadMarker};
use objc2_app_kit::{
    NSAnimationBlockingMode, NSView, NSViewAnimation, NSViewAnimationEndFrameKey,
    NSViewAnimationStartFrameKey, NSViewAnimationTargetKey, NSWindow, NSWindowTitleVisibility,
};
use objc2_foundation::{NSArray, NSDictionary, NSPoint, NSRect, NSSize, NSValue};
use tauri::{Manager, PhysicalPosition, PhysicalSize, WebviewWindow, Window, WindowEvent};

pub use super::toolbar::install_menu;
pub fn refresh_language(window: &WebviewWindow) {
    super::toolbar::refresh_language(window);
}
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
) -> tauri::Result<()> {
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
    Ok(())
}
pub fn on_event(window: &Window, event: &WindowEvent) {
    if matches!(event, WindowEvent::Resized(_)) {
        if crate::services::mini_mode::is_transitioning(window.app_handle()) {
            return;
        }
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

// Called on the AppKit thread, with minimum size constraints temporarily lifted.
// Keep Cocoa's bottom-left coordinates separate from Tauri's top-left pixels.
pub fn animate_bounds(
    window: &WebviewWindow,
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
) -> tauri::Result<()> {
    let scale = window.scale_factor()?;
    let current_position = window.outer_position()?;
    let current_size = window.inner_size()?;
    let pointer = window.ns_window()?;
    if pointer.is_null() {
        return Err(tauri::Error::WindowNotFound);
    }
    unsafe {
        let native = &*pointer.cast::<NSWindow>();
        let frame = native.frame();
        let width = frame.size.width + (size.width as f64 - current_size.width as f64) / scale;
        let height = frame.size.height + (size.height as f64 - current_size.height as f64) / scale;
        let target = NSRect::new(
            NSPoint::new(
                frame.origin.x + (position.x as f64 - current_position.x as f64) / scale,
                frame.origin.y - (position.y as f64 - current_position.y as f64) / scale
                    + frame.size.height
                    - height,
            ),
            NSSize::new(width, height),
        );
        let workspace_class = objc2::runtime::AnyClass::get(c"NSWorkspace");
        let reduce_motion = workspace_class.is_some_and(|class| {
            let workspace: *mut objc2::runtime::AnyObject = msg_send![class, sharedWorkspace];
            let reduced: bool = msg_send![workspace, accessibilityDisplayShouldReduceMotion];
            reduced
        });
        if reduce_motion {
            native.setFrame_display_animate(target, true, false);
        } else {
            let start: objc2::rc::Retained<NSValue> =
                msg_send![objc2::class!(NSValue), valueWithRect: frame];
            let end: objc2::rc::Retained<NSValue> =
                msg_send![objc2::class!(NSValue), valueWithRect: target];
            let properties = NSDictionary::from_slices(
                &[
                    NSViewAnimationTargetKey,
                    NSViewAnimationStartFrameKey,
                    NSViewAnimationEndFrameKey,
                ],
                &[
                    native.as_ref() as &objc2::runtime::AnyObject,
                    start.as_ref(),
                    end.as_ref(),
                ],
            );
            let animation = NSViewAnimation::initWithViewAnimations(
                NSViewAnimation::alloc(),
                &NSArray::from_slice(&[properties.as_ref()]),
            );
            animation.setDuration(0.16);
            animation.setFrameRate(0.0);
            animation.setAnimationBlockingMode(NSAnimationBlockingMode::Blocking);
            animation.startAnimation();
        }
    }
    Ok(())
}
