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
    Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_SYSTEMBACKDROP_TYPE},
    System::LibraryLoader::{GetModuleHandleA, GetProcAddress},
};

pub struct BackdropStatus {
    pub legacy: AtomicBool,
    pub custom: bool,
    pub error: Option<String>,
    pub amount: Mutex<f32>,
}

pub fn initialize(window: &tauri::WebviewWindow) -> BackdropStatus {
    let mut custom = false;
    let mut enabled = false;
    let mut error = None;
    if let (Ok(hwnd), Ok(size), Ok(scale)) =
        (window.hwnd(), window.inner_size(), window.scale_factor())
    {
        match super::custom_blur::install(hwnd, size.width, size.height, scale) {
            Ok(()) => custom = true,
            Err(cause) => {
                error = Some(cause.to_string());
                enabled = apply_acrylic(hwnd.0);
            }
        }
    }
    BackdropStatus {
        legacy: AtomicBool::new(enabled),
        custom,
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

fn set_accent(hwnd: HWND, state: u32, color: u32) -> bool {
    // Use the native accent Acrylic path rather than the Windows 11 transient
    // system backdrop, whose inactive appearance is managed by DWM.
    // This API is dynamically resolved because it is not a documented Win32 contract.
    unsafe {
        let module = GetModuleHandleA(b"user32.dll\0".as_ptr());
        if module.is_null() {
            return false;
        }
        let Some(address) = GetProcAddress(module, b"SetWindowCompositionAttribute\0".as_ptr())
        else {
            return false;
        };
        let set_attribute: SetCompositionAttribute = std::mem::transmute(address);
        let none = 1u32; // DWMSBT_NONE. Unsupported on Windows 10; accent remains available.
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_SYSTEMBACKDROP_TYPE as u32,
            &none as *const _ as _,
            std::mem::size_of_val(&none) as u32,
        );
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
    set_accent(hwnd, 4, 0x01f9fbfa)
}
pub fn disable_accent(hwnd: HWND) {
    set_accent(hwnd, 0, 0);
}

#[tauri::command]
pub fn background_settings(status: tauri::State<'_, BackdropStatus>) -> serde_json::Value {
    serde_json::json!({"mode":if status.custom { "custom-blur" } else if status.legacy.load(Ordering::Relaxed) { "acrylic" } else { "blur" },"amount":*status.amount.lock().unwrap(),"adjustableBlur":status.custom,"error":status.error})
}

fn validate_amount(amount: f32) -> Result<(), String> {
    if !amount.is_finite() || !(0.0..=60.0).contains(&amount) {
        return Err("模糊程度必须在 0 到 60 之间".into());
    }
    Ok(())
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
