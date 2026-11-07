use std::sync::atomic::{AtomicBool, Ordering};

static ENGLISH: AtomicBool = AtomicBool::new(false);

pub fn text<'a>(chinese: &'a str, english: &'a str) -> &'a str {
    if ENGLISH.load(Ordering::Relaxed) {
        english
    } else {
        chinese
    }
}

#[tauri::command]
pub async fn set_ui_language(window: tauri::WebviewWindow, language: String) -> Result<(), String> {
    if !["en", "zh-CN"].contains(&language.as_str()) {
        return Err("Unsupported interface language".into());
    }
    let handle = window.clone();
    let (tx, rx) = tokio::sync::oneshot::channel();
    window
        .run_on_main_thread(move || {
            ENGLISH.store(language == "en", Ordering::Relaxed);
            crate::platform::window::refresh_language(&handle);
            let _ = tx.send(());
        })
        .map_err(|error| error.to_string())?;
    rx.await.map_err(|_| "Window thread closed".into())
}
