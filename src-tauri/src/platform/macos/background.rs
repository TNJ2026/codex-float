use tauri::{
    window::{Effect, EffectState, EffectsBuilder},
    WebviewWindow,
};

pub struct BackdropStatus {
    mode: &'static str,
    error: Option<String>,
}
pub fn apply(window: &WebviewWindow, radius: f64) -> tauri::Result<()> {
    window.set_effects(
        EffectsBuilder::new()
            .effect(Effect::UnderWindowBackground)
            .state(EffectState::Active)
            .radius(radius)
            .build(),
    )
}
pub fn initialize(window: &WebviewWindow) -> BackdropStatus {
    match apply(window, 8.0) {
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
pub fn background_settings(status: tauri::State<'_, BackdropStatus>) -> serde_json::Value {
    serde_json::json!({"mode":status.mode,"amount":0,"adjustableBlur":false,"error":status.error})
}
#[tauri::command]
pub async fn set_background_blur(window: WebviewWindow, amount: f32) -> Result<f32, String> {
    let _ = (window, amount);
    Err("macOS 系统 Vibrancy 材质不提供与 Windows 相同的连续模糊强度接口".into())
}
