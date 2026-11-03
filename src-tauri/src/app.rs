use crate::{codex, platform, services};

pub fn run() {
    let app = tauri::Builder::default()
        .manage(codex::Bridge::default())
        .manage(services::mini_mode::MiniModeState::default())
        .setup(platform::initialize)
        .on_window_event(platform::on_window_event)
        .invoke_handler(tauri::generate_handler![
            codex::commands::connect_thread,
            codex::commands::send_prompt,
            codex::commands::reply_interaction,
            codex::index::list_threads,
            services::usage::read_usage,
            platform::background::background_settings,
            platform::background::set_background_blur,
            services::mini_mode::set_mini_mode,
            services::stop::stop_task,
            services::links::open_url,
            services::links::read_file_preview,
            services::links::reveal_file,
        ])
        .build(tauri::generate_context!())
        .expect("无法启动 Codex Float");
    app.run(|handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            codex::shutdown(handle);
        }
    });
}
