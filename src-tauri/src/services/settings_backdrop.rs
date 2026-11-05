use tauri::WebviewWindow;

#[tauri::command]
pub async fn settings_backdrop(
    window: WebviewWindow,
    rect: Option<[f64; 4]>,
) -> Result<bool, String> {
    if let Some(values) = rect {
        if values
            .iter()
            .any(|value| !value.is_finite() || value.abs() > 20_000.0)
            || values[2] <= 0.0
            || values[3] <= 0.0
        {
            return Err("设置面板尺寸无效".into());
        }
    }
    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let handle = window.clone();
        window
            .run_on_main_thread(move || {
                let _ = tx.send(crate::platform::background::settings_backdrop(
                    &handle, rect,
                ));
            })
            .map_err(|error| error.to_string())?;
        rx.await.map_err(|_| "窗口线程已关闭".to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
        Ok(false)
    }
}
