use serde_json::{json, Value};

fn stop_request(thread_id: &str, turn_id: &str) -> Result<Value, String> {
    uuid::Uuid::parse_str(thread_id).map_err(|_| "聊天 ID 格式不正确".to_string())?;
    if turn_id.trim().is_empty() || turn_id.len() > 256 {
        return Err("缺少有效的当前任务 ID".into());
    }
    Ok(json!({"conversationId":thread_id,"mode":"user-stop","expectedTurnId":turn_id}))
}

#[tauri::command]
pub async fn stop_task(
    app: tauri::AppHandle,
    thread_id: String,
    turn_id: String,
) -> Result<Value, String> {
    let params = stop_request(&thread_id, &turn_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let client = crate::codex::get_client(&app)?;
        let binding = client
            .binding
            .lock()
            .unwrap()
            .clone()
            .ok_or("请先连接聊天")?;
        if binding.0 != thread_id {
            return Err("聊天已切换，停止请求未发送".into());
        }
        // v4 requires expectedTurnId: the owner ignores a finished or replaced turn.
        let response = client.rpc(
            "thread-follower-interrupt-turn",
            params,
            4,
            Some(&binding.1),
        )?;
        Ok(response["result"].clone())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stop_is_bound_to_the_selected_thread_and_exact_turn() {
        let thread = "01a18161-4e42-7611-8f71-097de165a05b";
        let request = stop_request(thread, "turn-a").unwrap();
        assert_eq!(request["conversationId"], thread);
        assert_eq!(request["expectedTurnId"], "turn-a");
        assert_eq!(request["mode"], "user-stop");
        assert!(stop_request(thread, "").is_err());
        assert!(stop_request("invalid", "turn-a").is_err());
    }
}
