use objc2::{
    msg_send,
    rc::{Allocated, Retained},
    runtime::AnyClass,
    MainThreadMarker,
};
use objc2_app_kit::{NSAutoresizingMaskOptions, NSView, NSWindow};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use tauri::{
    window::{Effect, EffectState, EffectsBuilder},
    WebviewWindow,
};

pub struct BackdropStatus {
    mode: &'static str,
    error: Option<String>,
}
pub const CHAT_RADIUS: f64 = 20.0;

// A second native glass surface sits below the WebView's transparent settings
// content. Keeping it below the WebView preserves HTML input and focus handling.
pub fn settings_backdrop(window: &WebviewWindow, rect: Option<[f64; 4]>) -> Result<bool, String> {
    let Some(class) = AnyClass::get(c"NSGlassEffectView") else {
        return Ok(false);
    };
    let _main = MainThreadMarker::new().ok_or("玻璃材质必须在主线程更新")?;
    let pointer = window.ns_window().map_err(|error| error.to_string())?;
    if pointer.is_null() {
        return Err("无法获取原生窗口".into());
    }
    // SAFETY: Called on the main thread, with the NSWindow owned by Tauri.
    // The parent view retains the glass surface for its visible lifetime.
    unsafe {
        let native = &*pointer.cast::<NSWindow>();
        let root = native.contentView().ok_or("无法获取窗口内容")?;
        let root_is_glass: bool = msg_send![&*root, isKindOfClass: class];
        if !root_is_glass {
            return Ok(false);
        }
        let host: Retained<NSView> = msg_send![&*root, contentView];
        let existing = host.subviews().iter().find(|view| {
            let is_glass: bool = msg_send![&**view, isKindOfClass: class];
            is_glass
        });
        let Some([x, y, width, height]) = rect else {
            if let Some(view) = existing {
                view.removeFromSuperview();
            }
            return Ok(true);
        };
        let y = if host.isFlipped() {
            y
        } else {
            host.bounds().size.height - y - height
        };
        let frame = NSRect::new(NSPoint::new(x, y), NSSize::new(width, height));
        if let Some(view) = existing {
            view.setFrame(frame);
            return Ok(true);
        }
        let allocated: Allocated<NSView> = msg_send![class, alloc];
        let glass: Retained<NSView> = msg_send![allocated, initWithFrame: frame];
        let _: () = msg_send![&*glass, setStyle: CLEAR_GLASS_STYLE];
        let _: () = msg_send![&*glass, setCornerRadius: 16_f64];
        let _: () = msg_send![&*host, addSubview: &*glass, positioned: -1_isize, relativeTo: std::ptr::null::<NSView>()];
    }
    Ok(true)
}
const CLEAR_GLASS_STYLE: isize = 1;

// Resolve the class dynamically so the binary still launches on macOS 13–25.
// All calls originate from Tauri setup or the mini-mode main-thread closure.

fn apply_glass(window: &WebviewWindow, radius: f64) -> Result<bool, String> {
    let Some(class) = AnyClass::get(c"NSGlassEffectView") else {
        return Ok(false);
    };
    let _main = MainThreadMarker::new().ok_or("玻璃材质必须在主线程更新")?;
    let pointer = window.ns_window().map_err(|error| error.to_string())?;
    if pointer.is_null() {
        return Err("无法获取原生窗口".into());
    }
    // SAFETY: Tauri owns this NSWindow; it and all descendant views are used
    // only on the main thread. Retained handles keep the content alive while
    // moving it into NSGlassEffectView's documented contentView slot.
    unsafe {
        let native = &*pointer.cast::<NSWindow>();
        let content = native.contentView().ok_or("无法获取窗口内容")?;
        let already_glass: bool = msg_send![&*content, isKindOfClass: class];
        if already_glass {
            let _: () = msg_send![&*content, setCornerRadius: radius];
            return Ok(true);
        }
        let allocated: Allocated<NSView> = msg_send![class, alloc];
        let glass: Retained<NSView> = msg_send![allocated, initWithFrame: content.bounds()];
        // Clear Liquid Glass preserves more of the desktop's color and makes
        // the native refractive edge visible on this floating window.
        let _: () = msg_send![&*glass, setStyle: CLEAR_GLASS_STYLE];
        let _: () = msg_send![&*glass, setCornerRadius: radius];
        let resize = NSAutoresizingMaskOptions::ViewWidthSizable
            | NSAutoresizingMaskOptions::ViewHeightSizable;
        glass.setAutoresizingMask(resize);
        content.setAutoresizingMask(resize);
        let _: () = msg_send![&*glass, setContentView: &*content];
        native.setContentView(Some(&glass));
    }
    Ok(true)
}

fn apply_vibrancy(window: &WebviewWindow, radius: f64) -> tauri::Result<()> {
    window.set_effects(
        EffectsBuilder::new()
            .effect(Effect::UnderWindowBackground)
            .state(EffectState::Active)
            .radius(radius)
            .build(),
    )
}
pub fn apply(window: &WebviewWindow, radius: f64) -> Result<(), String> {
    if apply_glass(window, radius)? {
        return Ok(());
    }
    apply_vibrancy(window, radius).map_err(|error| error.to_string())
}
pub fn initialize(window: &WebviewWindow) -> BackdropStatus {
    match apply_glass(window, CHAT_RADIUS) {
        Ok(true) => {
            return BackdropStatus {
                mode: "liquid-glass",
                error: None,
            }
        }
        Ok(false) => {}
        Err(error) => {
            return match apply_vibrancy(window, CHAT_RADIUS) {
                Ok(()) => BackdropStatus {
                    mode: "vibrancy",
                    error: Some(error),
                },
                Err(fallback) => BackdropStatus {
                    mode: "transparent",
                    error: Some(format!("{error}; {fallback}")),
                },
            }
        }
    }
    match apply_vibrancy(window, CHAT_RADIUS) {
        Ok(()) => BackdropStatus {
            mode: "vibrancy",
            error: None,
        },
        Err(error) => BackdropStatus {
            mode: "transparent",
            error: Some(error.to_string()),
        },
    }
}
#[tauri::command]
pub async fn background_settings(
    window: WebviewWindow,
    status: tauri::State<'_, BackdropStatus>,
) -> Result<serde_json::Value, String> {
    let mode = status.mode;
    let error = status.error.clone();
    let (tx, rx) = tokio::sync::oneshot::channel();
    let handle = window.clone();
    window.run_on_main_thread(move || {
        let _ = tx.send(serde_json::json!({"mode":mode,"amount":0,"adjustableBlur":false,"nativeWindowControls":true,"titlebarHeight":super::window::titlebar_height(&handle),"error":error}));
    }).map_err(|error|error.to_string())?;
    rx.await.map_err(|_| "窗口线程已关闭".to_string())
}
#[tauri::command]
pub async fn set_background_blur(window: WebviewWindow, amount: f32) -> Result<f32, String> {
    let _ = (window, amount);
    Err("macOS 系统材质不提供连续模糊强度接口".into())
}
