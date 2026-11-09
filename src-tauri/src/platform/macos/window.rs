pub use super::toolbar::install_menu;
use objc2::{msg_send, AnyThread, MainThreadMarker};
use objc2_app_kit::{
    NSAnimationBlockingMode, NSFloatingWindowLevel, NSNormalWindowLevel, NSPopUpMenuWindowLevel,
    NSView, NSViewAnimation, NSViewAnimationEndFrameKey, NSViewAnimationStartFrameKey,
    NSViewAnimationTargetKey, NSWindow, NSWindowCollectionBehavior, NSWindowTitleVisibility,
};
use objc2_foundation::{NSArray, NSDictionary, NSPoint, NSRect, NSSize, NSValue};
use tauri::{Manager, PhysicalPosition, PhysicalSize, WebviewWindow, Window, WindowEvent};
pub fn refresh_language(window: &WebviewWindow) {
    super::toolbar::refresh_language(window);
}
pub fn initialize(window: &WebviewWindow) -> Result<(), String> {
    super::toolbar::install(window)?;
    let pointer = window.ns_window().map_err(|error| error.to_string())?;
    // SAFETY: Initialization is on AppKit's main thread and Tauri owns this window.
    let native = unsafe { pointer.cast::<NSWindow>().as_ref() }.ok_or("无法获取原生窗口")?;
    if let Some(content) = native.contentView() {
        super::text_input::install_window_level(&content);
    }
    let pinned = is_pinned(window).map_err(|error| error.to_string())?;
    set_pinned(window, pinned).map_err(|error| error.to_string())?;
    super::drag::install(window)?;
    Ok(())
}
// Keep the existing NSWindow/WebView. Pinned overlays must survive app hiding
// during fullscreen transitions and sit above browser video windows.
pub fn is_pinned(window: &WebviewWindow) -> tauri::Result<bool> {
    let _main =
        MainThreadMarker::new().ok_or_else(|| std::io::Error::other("窗口置顶必须在主线程读取"))?;
    let pointer = window.ns_window()?;
    if pointer.is_null() {
        return Err(std::io::Error::other("无法获取原生窗口").into());
    }
    // SAFETY: Tauri owns the window and this call runs on the AppKit thread.
    Ok(unsafe { (&*pointer.cast::<NSWindow>()).level() > NSNormalWindowLevel })
}
pub fn set_pinned(window: &WebviewWindow, pinned: bool) -> tauri::Result<()> {
    let _main =
        MainThreadMarker::new().ok_or_else(|| std::io::Error::other("窗口置顶必须在主线程更新"))?;
    let pointer = window.ns_window()?;
    if pointer.is_null() {
        return Err(std::io::Error::other("无法获取原生窗口").into());
    }
    window.app_handle().set_activation_policy(if pinned {
        tauri::ActivationPolicy::Accessory
    } else {
        tauri::ActivationPolicy::Regular
    })?;
    configure_spaces(window).map_err(std::io::Error::other)?;
    // SAFETY: Native policies and ordering are changed together on the main
    // thread; no queued Tauri level change can overwrite the overlay level.
    unsafe {
        let native = &*pointer.cast::<NSWindow>();
        native.setCanHide(!pinned);
        native.setHidesOnDeactivate(false);
        native.setLevel(pinned_window_level(pinned, native.isKeyWindow()));
        if pinned {
            native.orderFrontRegardless();
        }
    }
    Ok(())
}
// A key window is being used interactively: ordinary floating level lets IME,
// context menus and system UI stay above it. The stronger level is only needed
// while another app owns keyboard focus (including fullscreen video).
fn pinned_window_level(pinned: bool, focused: bool) -> isize {
    if !pinned {
        NSNormalWindowLevel
    } else if focused {
        NSFloatingWindowLevel
    } else {
        NSPopUpMenuWindowLevel
    }
}
fn update_focus_level(window: &Window, focused: bool) {
    let Some(_main) = MainThreadMarker::new() else {
        return;
    };
    let Ok(pointer) = window.ns_window() else {
        return;
    };
    // SAFETY: The event originates on AppKit's main thread; Tauri owns NSWindow.
    let Some(native) = (unsafe { pointer.cast::<NSWindow>().as_ref() }) else {
        return;
    };
    let pinned = native.level() > NSNormalWindowLevel;
    native.setLevel(pinned_window_level(pinned, focused));
}
fn floating_collection_behavior(current: NSWindowCollectionBehavior) -> NSWindowCollectionBehavior {
    // These modes are mutually exclusive with joining every Space and acting
    // as an auxiliary window alongside another application's fullscreen window.
    let conflicting = NSWindowCollectionBehavior::MoveToActiveSpace
        | NSWindowCollectionBehavior::FullScreenPrimary
        | NSWindowCollectionBehavior::FullScreenNone
        | NSWindowCollectionBehavior::Primary
        | NSWindowCollectionBehavior::Auxiliary;
    (current & !conflicting)
        | NSWindowCollectionBehavior::CanJoinAllSpaces
        | NSWindowCollectionBehavior::FullScreenAuxiliary
        | NSWindowCollectionBehavior::CanJoinAllApplications
}
fn configure_spaces(window: &WebviewWindow) -> Result<(), String> {
    let _main = MainThreadMarker::new().ok_or("窗口空间行为必须在主线程更新")?;
    let pointer = window.ns_window().map_err(|error| error.to_string())?;
    if pointer.is_null() {
        return Err("无法获取原生窗口".into());
    }
    // SAFETY: Tauri owns this NSWindow and initialization runs on the AppKit thread.
    unsafe {
        let native = &*pointer.cast::<NSWindow>();
        native.setCollectionBehavior(floating_collection_behavior(native.collectionBehavior()));
    }
    Ok(())
}
pub fn titlebar_height(window: &WebviewWindow) -> f64 {
    super::toolbar::height(window)
}

#[cfg(test)]
mod space_tests {
    use super::*;

    #[test]
    fn keyboard_focus_keeps_pinning_but_releases_system_ui_levels() {
        let interactive = pinned_window_level(true, true);
        let background = pinned_window_level(true, false);
        assert!(interactive > NSNormalWindowLevel);
        assert!(interactive < background);
        assert_eq!(interactive, NSFloatingWindowLevel);
        assert_eq!(background, NSPopUpMenuWindowLevel);
        assert_eq!(pinned_window_level(false, true), NSNormalWindowLevel);
        assert_eq!(pinned_window_level(false, false), NSNormalWindowLevel);
    }

    #[test]
    fn fullscreen_overlay_preserves_other_policies_without_conflicting_space_modes() {
        for mode in [
            NSWindowCollectionBehavior::FullScreenPrimary,
            NSWindowCollectionBehavior::FullScreenNone,
            NSWindowCollectionBehavior::Primary,
            NSWindowCollectionBehavior::Auxiliary,
        ] {
            let current = mode
                | NSWindowCollectionBehavior::MoveToActiveSpace
                | NSWindowCollectionBehavior::IgnoresCycle;
            let result = floating_collection_behavior(current);
            assert!(result.contains(NSWindowCollectionBehavior::CanJoinAllSpaces));
            assert!(result.contains(NSWindowCollectionBehavior::FullScreenAuxiliary));
            assert!(result.contains(NSWindowCollectionBehavior::CanJoinAllApplications));
            assert!(result.contains(NSWindowCollectionBehavior::IgnoresCycle));
            assert!(!result.intersects(
                NSWindowCollectionBehavior::MoveToActiveSpace
                    | NSWindowCollectionBehavior::FullScreenPrimary
                    | NSWindowCollectionBehavior::FullScreenNone
                    | NSWindowCollectionBehavior::Primary
                    | NSWindowCollectionBehavior::Auxiliary
            ));
            assert_eq!(floating_collection_behavior(result), result);
        }
    }
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
    if let WindowEvent::Focused(focused) = event {
        update_focus_level(window, *focused);
    }
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
    // Restoring from the ball is an explicit request to interact with chat.
    let _ = window.set_focus();
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
