use block2::RcBlock;
use objc2::{
    msg_send,
    rc::Retained,
    runtime::{AnyClass, AnyObject},
    sel, MainThreadMarker,
};
use objc2_app_kit::{NSEvent, NSEventMask, NSView, NSWindow};
use objc2_foundation::NSString;
use std::{
    cell::RefCell,
    ptr::{self, NonNull},
};
use tauri::WebviewWindow;

struct Monitor(Retained<AnyObject>);
impl Drop for Monitor {
    fn drop(&mut self) {
        unsafe {
            NSEvent::removeMonitor(&self.0);
        }
    }
}
thread_local! { static MONITOR: RefCell<Option<Monitor>> = const { RefCell::new(None) }; }

fn in_titlebar(x: f64, y: f64, width: f64, height: f64, safe_top: f64, clicks: isize) -> bool {
    clicks == 1 && x >= 0.0 && x < width && y >= safe_top && y < height
}

// Walk the actual hit view's ancestors rather than assuming button positions.
// Native title text remains draggable; native buttons and sharing controls do not.
unsafe fn interactive(mut view: Option<Retained<NSView>>) -> bool {
    while let Some(current) = view {
        if let Some(class) = AnyClass::get(c"NSButton") {
            let button: bool = msg_send![&*current, isKindOfClass: class];
            if button {
                return true;
            }
        }
        let has_role: bool = msg_send![&*current, respondsToSelector: sel!(accessibilityRole)];
        if has_role {
            let role: Option<Retained<NSString>> = msg_send![&*current, accessibilityRole];
            if role.is_some_and(|role| {
                matches!(
                    role.to_string().as_str(),
                    "AXButton"
                        | "AXMenuButton"
                        | "AXPopUpButton"
                        | "AXCheckBox"
                        | "AXRadioButton"
                        | "AXSwitch"
                )
            }) {
                return true;
            }
        }
        view = current.superview();
    }
    false
}

pub fn install(window: &WebviewWindow) -> Result<(), String> {
    let mtm = MainThreadMarker::new().ok_or("窗口拖动必须在主线程初始化")?;
    let pointer = window.ns_window().map_err(|error| error.to_string())?;
    // SAFETY: Tauri owns the NSWindow. The monitor retains it and is removed
    // on the same AppKit thread before its captured references are released.
    unsafe {
        let target = Retained::retain(pointer.cast::<NSWindow>()).ok_or("无法获取原生窗口")?;
        target.setMovable(true);
        let focus_window = window.clone();
        let handler = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
            let event_ref = event.as_ref();
            let Some(owner) = event_ref.window(mtm) else {
                return event.as_ptr();
            };
            if !ptr::eq(&*owner, &*target) {
                return event.as_ptr();
            }
            // Accessory apps at an elevated level do not always activate on a
            // click. Focus before custom dragging consumes the titlebar event;
            // keep first responder selection to AppKit/the clicked control.
            let application: *mut AnyObject = msg_send![
                AnyClass::get(c"NSApplication").expect("AppKit application class"),
                sharedApplication
            ];
            let active: bool = msg_send![application, isActive];
            if !active || !target.isKeyWindow() {
                let _ = focus_window.set_focus();
            }
            if !target.isMovable() || !target.toolbar().is_some_and(|toolbar| toolbar.isVisible()) {
                return event.as_ptr();
            }
            let point = event_ref.locationInWindow();
            let safe = target.contentLayoutRect();
            let size = target.frame().size;
            if !in_titlebar(
                point.x,
                point.y,
                size.width,
                size.height,
                safe.origin.y + safe.size.height,
                event_ref.clickCount(),
            ) {
                return event.as_ptr();
            }
            let hit = target
                .contentView()
                .and_then(|view| view.superview())
                .and_then(|frame| frame.hitTest(point));
            if hit.is_none() || interactive(hit) {
                return event.as_ptr();
            }
            target.performWindowDragWithEvent(event_ref);
            ptr::null_mut()
        });
        let monitor = NSEvent::addLocalMonitorForEventsMatchingMask_handler(
            NSEventMask::LeftMouseDown,
            &handler,
        )
        .ok_or("无法初始化标题栏拖动")?;
        MONITOR.with(|slot| *slot.borrow_mut() = Some(Monitor(monitor)));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::in_titlebar;
    #[test]
    fn only_single_clicks_inside_the_measured_titlebar_start_dragging() {
        assert!(in_titlebar(200.0, 695.0, 450.0, 720.0, 668.0, 1));
        assert!(!in_titlebar(200.0, 500.0, 450.0, 720.0, 668.0, 1));
        assert!(!in_titlebar(-1.0, 695.0, 450.0, 720.0, 668.0, 1));
        assert!(!in_titlebar(451.0, 695.0, 450.0, 720.0, 668.0, 1));
        assert!(!in_titlebar(200.0, 721.0, 450.0, 720.0, 668.0, 1));
        assert!(!in_titlebar(200.0, 695.0, 450.0, 720.0, 668.0, 2));
    }
}
