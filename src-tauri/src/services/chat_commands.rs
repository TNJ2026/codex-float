use serde_json::{json, Value};

fn mode_patch(mode: &str, settings: &Value) -> Result<Value, String> {
    if !matches!(mode, "plan" | "default") {
        return Err("不支持的聊天模式".into());
    }
    let model = settings["model"]
        .as_str()
        .filter(|value| !value.is_empty())
        .ok_or("当前聊天缺少模型设置，请重新同步")?;
    Ok(
        json!({"collaborationMode":{"mode":mode,"settings":{"model":model,"reasoning_effort":settings["reasoningEffort"],"developer_instructions":null}}}),
    )
}

#[tauri::command]
pub async fn run_chat_command(
    app: tauri::AppHandle,
    thread_id: String,
    command: String,
) -> Result<Value, String> {
    if !matches!(command.as_str(), "compact" | "plan" | "agent") {
        return Err("不支持的聊天命令".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let client = crate::codex::get_client(&app)?;
        let binding = client.binding.lock().map_err(|_| "聊天连接不可用")?.clone().ok_or("请先连接聊天")?;
        if binding.0 != thread_id { return Err("聊天已切换，命令未执行".into()); }
        if command == "compact" {
            let result = client.rpc("thread-follower-compact-thread", json!({"conversationId":thread_id}), 1, Some(&binding.1))?;
            if result["result"]["ok"] != true { return Err("压缩请求未确认，请重新同步聊天".into()); }
            return Ok(json!({"ok":true}));
        }
        let response = client.rpc("thread-follower-read-model-settings", json!({"conversationId":thread_id}), 1, Some(&binding.1))?;
        let settings = &response["result"]["settings"];
        let patch = mode_patch(if command == "plan" { "plan" } else { "default" }, settings)?;
        let mut params = json!({"conversationId":thread_id,"threadSettings":patch,"condition":{"ifModelEquals":settings["model"]}});
        if let Some(effort) = settings.get("reasoningEffort") { params["condition"]["ifEffortEquals"] = effort.clone(); }
        let result = client.rpc("thread-follower-update-thread-settings", params, 2, Some(&binding.1))?;
        if result["result"]["applied"] != true { return Err("模式未保存，主窗口设置可能已变化，请重试".into()); }
        Ok(json!({"threadSettings":patch}))
    }).await.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn modes_preserve_model_and_effort_and_do_not_change_permissions() {
        let patch = mode_patch("plan", &json!({"model":"test","reasoningEffort":"high"})).unwrap();
        assert_eq!(patch["collaborationMode"]["settings"]["model"], "test");
        assert_eq!(
            patch["collaborationMode"]["settings"]["reasoning_effort"],
            "high"
        );
        assert_eq!(patch["collaborationMode"]["mode"], "plan");
        assert_eq!(patch.as_object().unwrap().len(), 1);
        assert!(mode_patch("invalid", &json!({"model":"test"})).is_err());
        assert!(mode_patch("default", &json!({})).is_err());
    }
}
