use crate::{codex, platform, services};
use tauri::Manager;

pub fn run() {
    let app = tauri::Builder::default()
        .append_invoke_initialization_script(format!(
            "window.__CODEX_FLOAT_PLATFORM__ = '{}';",
            std::env::consts::OS
        ))
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .manage(codex::Bridge::default())
        .manage(services::mini_mode::MiniModeState::default())
        .manage(services::model_settings::ModelSettingsState::default())
        .manage(services::mcp_apps::McpAppsState::default())
        .manage(services::mcp_tool_calls::McpToolState::default())
        .manage(services::forks::ForkState::default())
        .manage(services::predictions::PredictionState::default())
        .setup(|app| {
            platform::initialize(app)?;
            services::attachments::initialize(app.handle().clone());
            Ok(())
        })
        .on_window_event(platform::on_window_event)
        .invoke_handler(tauri::generate_handler![
            codex::commands::connect_thread,
            codex::commands::find_running_thread,
            codex::commands::send_prompt,
            codex::commands::reply_interaction,
            codex::index::list_threads,
            services::usage::read_usage,
            services::attachments::pick_attachments,
            services::attachments::inspect_attachments,
            services::attachments::save_attachment,
            services::attachments::open_attachment_cache,
            services::attachments::clipboard_attachment_paths,
            services::context::pick_context_paths,
            services::context::search_context_files,
            services::context::search_context_threads,
            services::context::read_ide_context,
            services::context::read_browser_contexts,
            services::catalog::context_catalog,
            services::model_settings::read_model_options,
            services::model_settings::update_model_settings,
            services::chat_commands::run_chat_command,
            services::message_actions::copy_text,
            services::message_actions::edit_sent_message,
            services::speed_settings::update_speed_settings,
            services::mcp_apps::load_mcp_app,
            services::mcp_apps::release_mcp_app,
            services::mcp_apps::read_mcp_app_resource,
            services::mcp_tool_calls::mcp_app_tool,
            services::mcp_tool_calls::reply_mcp_app_request,
            services::mcp_apps::load_rich_preview,
            services::forks::fork_message,
            services::forks::restore_fork_settings,
            services::predictions::predict_message,
            services::predictions::cancel_prediction,
            services::subagent_actions::subagent_action,
            #[cfg(target_os = "macos")]
            platform::window::focus_composer,
            platform::background::background_settings,
            services::ui_language::set_ui_language,
            #[cfg(target_os = "windows")]
            platform::background::acrylic_opacity,
            services::settings_backdrop::settings_backdrop,
            platform::background::set_background_blur,
            services::mini_mode::set_mini_mode,
            services::mini_mode::get_mini_mode,
            services::stop::stop_task,
            services::links::open_url,
            services::links::open_file,
            services::links::read_file_preview,
            services::links::reveal_file,
        ])
        .build(tauri::generate_context!())
        .expect("无法启动 CodexFloat");
    app.run(|handle, event| {
        #[cfg(target_os = "macos")]
        if matches!(
            event,
            tauri::RunEvent::Ready | tauri::RunEvent::Reopen { .. }
        ) {
            // Activation policy is settled after launch. Raising an accessory
            // window alone does not make it the keyboard/main window.
            if let Some(window) = handle.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }
        if matches!(event, tauri::RunEvent::Exit) {
            codex::shutdown(handle);
            services::mcp_apps::shutdown(handle);
        }
    });
}
