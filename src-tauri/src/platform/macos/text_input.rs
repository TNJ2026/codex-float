use objc2::{
    runtime::{AnyClass, AnyProtocol, Imp, Sel},
    sel,
};
use objc2_app_kit::NSView;
use objc2_foundation::NSObjectProtocol;

// AppKit asks NSTextInputClient for its window level when placing IME UI.
// WebKit omits this optional method, leaving candidate windows behind overlays.
pub fn install_window_level(view: &NSView) {
    let Some(protocol) = AnyProtocol::get(c"NSTextInputClient") else {
        return;
    };
    if view.conformsToProtocol(protocol) {
        let mut class = view.class();
        // Attach only to Wry's stable subclass, never WebKit's system class or
        // an ephemeral KVO subclass which WebKit may later replace.
        while let Some(parent) = class.superclass() {
            if parent.name().to_bytes() == b"WKWebView" {
                break;
            }
            class = parent;
        }
        if class
            .superclass()
            .is_some_and(|parent| parent.name().to_bytes() == b"WKWebView")
        {
            add_window_level(class);
        }
    }
    for child in view.subviews() {
        install_window_level(&child);
    }
}

fn add_window_level(class: &AnyClass) {
    let selector = sel!(windowLevel);
    if class.instance_method(selector).is_some() {
        return;
    }
    unsafe extern "C-unwind" fn window_level(view: &NSView, _selector: Sel) -> isize {
        view.window().map_or(0, |window| window.level())
    }
    let method: unsafe extern "C-unwind" fn(&NSView, Sel) -> isize = window_level;
    // SAFETY: q@: is the 64-bit NSInteger return type with id/SEL arguments.
    // Registered classes and this function live for the process lifetime.
    unsafe {
        let implementation: Imp = std::mem::transmute(method);
        objc2::ffi::class_addMethod(
            class as *const _ as *mut _,
            selector,
            implementation,
            c"q@:".as_ptr(),
        );
    }
}
