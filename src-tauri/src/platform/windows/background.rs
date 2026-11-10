use super::desktop_acrylic::Opacity;
use std::{
    ffi::c_void,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::Manager;
use windows_sys::Win32::{
    Foundation::HWND,
    Graphics::Dwm::{
        DwmSetWindowAttribute, DWMSBT_NONE, DWMSBT_TRANSIENTWINDOW, DWMWA_SYSTEMBACKDROP_TYPE,
    },
    System::LibraryLoader::{GetModuleHandleA, GetProcAddress},
};

pub struct BackdropStatus {
    pub legacy: AtomicBool,
    pub custom: bool,
    pub controller: bool,
    pub title_bar_height: Option<f64>,
    pub system_acrylic: bool,
    pub error: Option<String>,
    pub amount: Mutex<f32>,
}

pub fn initialize(window: &tauri::WebviewWindow) -> BackdropStatus {
    let mut custom = false;
    let mut controller = false;
    let mut title_bar_height = None;
    let mut enabled = false;
    let mut system_acrylic = false;
    let mut error = None;
    if let (Ok(hwnd), Ok(size), Ok(scale)) =
        (window.hwnd(), window.inner_size(), window.scale_factor())
    {
        disable_accent(hwnd.0);
        let dark = window
            .theme()
            .is_ok_and(|theme| theme == tauri::Theme::Dark);
        match super::custom_blur::install(hwnd, size.width, size.height, scale) {
            Ok(()) => custom = true,
            Err(cause) => error = Some(cause.to_string()),
        }
        if custom {
            if super::desktop_acrylic::extend_custom_title_bar(hwnd, dark).is_ok() {
                if let Ok(size) = window.inner_size() {
                    super::custom_blur::resize(size.width, size.height, scale);
                }
                title_bar_height = Some(super::desktop_acrylic::title_bar_height(scale));
            }
        } else {
            controller = super::desktop_acrylic::install(hwnd, dark);
        }
        if controller {
            error = None;
            title_bar_height = Some(super::desktop_acrylic::title_bar_height(scale));
        } else if title_bar_height.is_none() {
            system_acrylic = set_system_acrylic(hwnd.0, true);
            if system_acrylic {
                error = None;
            } else if !custom {
                enabled = set_accent(hwnd.0, 4, 0x01f9fbfa);
            }
        }
    }
    BackdropStatus {
        legacy: AtomicBool::new(enabled),
        custom,
        controller,
        title_bar_height,
        system_acrylic,
        error,
        amount: Mutex::new(super::custom_blur::DEFAULT_AMOUNT),
    }
}

#[repr(C)]
struct AccentPolicy {
    state: u32,
    flags: u32,
    gradient_color: u32,
    animation_id: u32,
}
#[repr(C)]
struct CompositionAttributeData {
    attribute: u32,
    data: *mut c_void,
    size: usize,
}
type SetCompositionAttribute =
    unsafe extern "system" fn(HWND, *mut CompositionAttributeData) -> i32;

pub fn set_system_acrylic(hwnd: HWND, enabled: bool) -> bool {
    let backdrop = if enabled {
        DWMSBT_TRANSIENTWINDOW
    } else {
        DWMSBT_NONE
    };
    let applied = unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_SYSTEMBACKDROP_TYPE as u32,
            &backdrop as *const _ as _,
            std::mem::size_of_val(&backdrop) as u32,
        ) >= 0
    };
    super::custom_blur::set_visible(!enabled || !applied);
    applied
}

fn set_accent(hwnd: HWND, state: u32, color: u32) -> bool {
    // Older Windows builds use the accent policy when DWM lacks Desktop Acrylic.
    unsafe {
        let module = GetModuleHandleA(c"user32.dll".as_ptr().cast());
        if module.is_null() {
            return false;
        }
        let Some(address) =
            GetProcAddress(module, c"SetWindowCompositionAttribute".as_ptr().cast())
        else {
            return false;
        };
        let set_attribute: SetCompositionAttribute = std::mem::transmute(address);
        let mut policy = AccentPolicy {
            state,
            flags: 0,
            // Minimum nonzero native tint; the web surface owns the configurable theme tint.
            gradient_color: color,
            animation_id: 0,
        };
        let mut data = CompositionAttributeData {
            attribute: 19, // WCA_ACCENT_POLICY
            data: &mut policy as *mut _ as _,
            size: std::mem::size_of_val(&policy),
        };
        set_attribute(hwnd, &mut data) != 0
    }
}
pub fn apply_acrylic(hwnd: HWND) -> bool {
    set_system_acrylic(hwnd, true) || set_accent(hwnd, 4, 0x01f9fbfa)
}
pub fn disable_accent(hwnd: HWND) {
    set_system_acrylic(hwnd, false);
    set_accent(hwnd, 0, 0);
}

#[tauri::command]
pub fn background_settings(status: tauri::State<'_, BackdropStatus>) -> serde_json::Value {
    let mode = if status.controller {
        "desktop-acrylic-controller"
    } else if status.system_acrylic {
        "desktop-acrylic"
    } else if status.custom {
        "custom-blur"
    } else if status.legacy.load(Ordering::Relaxed) {
        "acrylic"
    } else {
        "blur"
    };
    serde_json::json!({"mode":mode,"amount":*status.amount.lock().unwrap(),"adjustableBlur":status.custom&&!status.system_acrylic,"titlebarHeight":status.title_bar_height,"error":status.error})
}

fn validate_amount(amount: f32) -> Result<(), String> {
    if !amount.is_finite() || !(0.0..=60.0).contains(&amount) {
        return Err("模糊程度必须在 0 到 60 之间".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn acrylic_opacity(
    window: tauri::WebviewWindow,
    opacity: Option<Opacity>,
) -> Result<Opacity, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    window
        .run_on_main_thread(move || {
            let _ = tx.send(super::desktop_acrylic::opacity_settings(opacity));
        })
        .map_err(|error| error.to_string())?;
    rx.await.map_err(|_| "窗口线程已关闭".to_string())?
}

#[tauri::command]
pub async fn set_background_blur(window: tauri::WebviewWindow, amount: f32) -> Result<f32, String> {
    validate_amount(amount)?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    let handle = window.clone();
    window
        .run_on_main_thread(move || {
            let result = (|| -> Result<f32, String> {
                super::custom_blur::set_amount(amount).map_err(|error| error.to_string())?;
                *handle.state::<BackdropStatus>().amount.lock().unwrap() = amount;
                Ok(amount)
            })();
            let _ = tx.send(result);
        })
        .map_err(|error| error.to_string())?;
    rx.await.map_err(|_| "窗口线程已关闭".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn blur_amount_is_bounded_and_finite() {
        for amount in [0.0, 10.0, 60.0] {
            assert!(validate_amount(amount).is_ok());
        }
        for amount in [-1.0, 61.0, f32::NAN, f32::INFINITY] {
            assert!(validate_amount(amount).is_err());
        }
    }
}
