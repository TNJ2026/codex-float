use serde_json::{json, Value};
#[cfg(target_os = "windows")]
use tauri::Manager;

#[tauri::command]
pub async fn copy_text(app: tauri::AppHandle, text: String) -> Result<(), String> {
    if text.len() > 16_000_000 || text.contains('\0') {
        return Err("文本过大或含有无法复制的空字符".into());
    }
    #[cfg(target_os = "windows")]
    let owner = app
        .get_webview_window("main")
        .ok_or("悬浮窗已关闭")?
        .hwnd()
        .map_err(|error| error.to_string())?
        .0 as isize;
    #[cfg(target_os = "macos")]
    let owner = {
        let _ = app;
        0
    };
    tauri::async_runtime::spawn_blocking(move || {
        crate::platform::clipboard::write_text(&text, owner)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn edit_params(thread_id: &str, turn_id: &str, text: &str) -> Result<Value, String> {
    uuid::Uuid::parse_str(thread_id).map_err(|_| "聊天 ID 格式不正确")?;
    if turn_id.trim().is_empty() || turn_id.len() > 256 {
        return Err("缺少有效的消息轮次".into());
    }
    if text.trim().is_empty() || text.len() > 100_000 {
        return Err("消息不能为空或超过 100000 字节".into());
    }
    Ok(
        json!({"conversationId":thread_id,"turnId":turn_id,"message":text,"allowEarlierMessages":true,"shouldSendPermissionOverrides":false}),
    )
}

#[tauri::command]
pub async fn edit_sent_message(
    app: tauri::AppHandle,
    thread_id: String,
    turn_id: String,
    text: String,
) -> Result<Value, String> {
    let params = edit_params(&thread_id, &turn_id, &text)?;
    tauri::async_runtime::spawn_blocking(move || {
        let client = crate::codex::get_client(&app)?;
        let binding = client
            .binding
            .lock()
            .map_err(|_| "聊天连接不可用")?
            .clone()
            .ok_or("请先连接聊天")?;
        if binding.0 != thread_id {
            return Err("聊天已切换，消息未编辑".into());
        }
        let result = client.rpc(
            "thread-follower-edit-last-user-turn",
            params,
            2,
            Some(&binding.1),
        )?;
        if result["result"]["ok"] != true {
            return Err("编辑未确认，请同步聊天后检查结果，避免重复提交".into());
        }
        Ok(json!({"ok":true}))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn editing_targets_a_turn_and_never_sends_permission_overrides() {
        let thread = "00000000-0000-4000-8000-000000000001";
        let params = edit_params(thread, "turn-1", "更新后的消息").unwrap();
        assert_eq!(params["turnId"], "turn-1");
        assert_eq!(params["message"], "更新后的消息");
        assert_eq!(params["allowEarlierMessages"], true);
        assert_eq!(params["shouldSendPermissionOverrides"], false);
        assert!(params.get("input").is_none());
        assert!(edit_params("invalid", "turn", "text").is_err());
        assert!(edit_params(thread, "", "text").is_err());
        assert!(edit_params(thread, "turn", " ").is_err());
    }
}
