use serde_json::{json, Value};
fn last_turn(state: &Value) -> Option<&Value> {
    let history = &state["turnHistory"]["history"];
    if let Some(islands) = history["islands"].as_array() {
        for island in islands.iter().rev() {
            if let Some(entries) = island["entries"].as_array() {
                for entry in entries.iter().rev() {
                    if let Some(key) = entry["value"].as_str() {
                        if let Some(turn) = history["entitiesByKey"].get(key) {
                            return Some(turn);
                        }
                    }
                }
            }
        }
    }
    state["turns"].as_array().and_then(|turns| turns.last())
}
fn action_params(
    child: &str,
    state: &Value,
    action: &str,
    text: &str,
    expected: &str,
) -> Result<(&'static str, u32, Value), String> {
    let turn = last_turn(state).ok_or("子代理暂无可操作的轮次")?;
    let id = turn["turnId"]
        .as_str()
        .or_else(|| turn["id"].as_str())
        .ok_or("无法读取子代理轮次")?;
    if id != expected {
        return Err("子代理已进入新轮次，请刷新后重试".into());
    }
    let running = turn["status"] == "inProgress";
    if action == "stop" {
        if !running {
            return Err("子代理当前没有运行任务".into());
        }
        return Ok((
            "thread-follower-interrupt-turn",
            4,
            json!({"conversationId":child,"mode":"user-stop","expectedTurnId":id}),
        ));
    }
    if action != "send" || text.trim().is_empty() || text.len() > 100_000 {
        return Err("子代理指令无效".into());
    }
    let message = uuid::Uuid::new_v4().to_string();
    let input = json!([{"type":"text","text":text,"text_elements":[]}]);
    let restore = json!({"id":message,"text":text,"context":{"prompt":text,"fileAttachments":[],"contextItems":[],"threadReferences":[]}});
    if running {
        Ok((
            "thread-follower-steer-turn",
            1,
            json!({"conversationId":child,"input":input,"restoreMessage":restore,"attachments":[],"clientUserMessageId":message}),
        ))
    } else {
        Ok((
            "thread-follower-start-turn",
            2,
            json!({"conversationId":child,"turnStart":{"request":{"threadId":child,"input":input,"clientUserMessageId":message,"turnTrigger":"composer"},"context":{"commentAttachments":[],"attachments":[],"restoreMessage":restore}}}),
        ))
    }
}
#[tauri::command]
pub async fn subagent_action(
    app: tauri::AppHandle,
    parent_id: String,
    child_id: String,
    action: String,
    text: Option<String>,
    expected_turn_id: Option<String>,
) -> Result<Value, String> {
    uuid::Uuid::parse_str(&child_id).map_err(|_| "子代理 ID 无效")?;
    if parent_id == child_id {
        return Err("不能将父聊天作为子代理操作".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let client = crate::codex::get_client(&app)?;
        let check = || -> Result<(), String> {
            if client
                .binding
                .lock()
                .map_err(|_| "连接不可用")?
                .as_ref()
                .map(|b| b.0.as_str())
                != Some(parent_id.as_str())
            {
                return Err("父聊天已切换，操作已取消".into());
            }
            Ok(())
        };
        check()?;
        let owner = client.rpc(
            "thread-owner-discovery",
            json!({"hostId":"local","conversationId":child_id}),
            1,
            None,
        )?;
        let owner = owner["handledByClientId"]
            .as_str()
            .ok_or("子代理未运行，请在主 App 打开其对话")?;
        let state = client.inspect_thread(&child_id, owner)?;
        check()?;
        if action == "inspect" {
            return Ok(json!({"state":state}));
        }
        let (method, version, params) = action_params(
            &child_id,
            &state,
            &action,
            text.as_deref().unwrap_or(""),
            expected_turn_id.as_deref().unwrap_or(""),
        )?;
        let result = client.rpc(method, params, version, Some(owner))?;
        Ok(json!({"accepted":true,"result":result["result"]}))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn concurrent_children_never_share_targets_turns_or_message_ids() {
        let handles: Vec<_> = (0..48)
            .map(|index| {
                std::thread::spawn(move || {
                    let child = format!("child-{}", index % 3);
                    let turn = format!("turn-{}", index % 3);
                    let state = json!({"turns":[{"id":turn,"status":"inProgress"}]});
                    let text = format!("instruction-{index}");
                    let (_, _, send) = action_params(&child, &state, "send", &text, &turn).unwrap();
                    let (_, _, stop) = action_params(&child, &state, "stop", "", &turn).unwrap();
                    assert_eq!(send["conversationId"], child);
                    assert_eq!(send["input"][0]["text"], text);
                    assert_eq!(stop["conversationId"], child);
                    assert_eq!(stop["expectedTurnId"], turn);
                    assert!(action_params(
                        &child,
                        &state,
                        "stop",
                        "",
                        &format!("turn-{}", (index + 1) % 3)
                    )
                    .is_err());
                    send["clientUserMessageId"].as_str().unwrap().to_owned()
                })
            })
            .collect();
        let ids: std::collections::HashSet<_> = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect();
        assert_eq!(ids.len(), 48);
    }
    #[test]
    fn canonical_history_uses_latest_turn_and_rejects_invalid_operations() {
        let state = json!({"turns":[],"turnHistory":{"history":{"entitiesByKey":{"old":{"turnId":"old","status":"completed"},"new":{"turnId":"new","status":"inProgress"}},"islands":[{"entries":[{"value":"old"},{"value":"new"}]},{"entries":[]}]}}});
        assert!(action_params("child", &state, "stop", "", "old").is_err());
        let (_, _, params) = action_params("child", &state, "stop", "", "new").unwrap();
        assert_eq!(params["expectedTurnId"], "new");
        assert!(action_params("child", &state, "send", "   ", "new").is_err());
        assert!(action_params("child", &state, "delete", "hello", "new").is_err());
        assert!(action_params("child", &json!({"turns":[]}), "send", "hello", "new").is_err());
    }
    #[test]
    fn actions_target_only_the_child_and_guard_replaced_turns() {
        let state = json!({"turns":[{"id":"turn","status":"inProgress"}]});
        let (_, v, p) = action_params("child", &state, "stop", "", "turn").unwrap();
        assert_eq!(v, 4);
        assert_eq!(p["expectedTurnId"], "turn");
        assert_eq!(p["conversationId"], "child");
        assert!(action_params("child", &state, "stop", "", "old").is_err());
        assert_eq!(
            action_params("child", &state, "send", "hello", "turn")
                .unwrap()
                .0,
            "thread-follower-steer-turn"
        );
        let state = json!({"turns":[{"id":"turn","status":"completed"}]});
        assert!(action_params("child", &state, "stop", "", "turn").is_err());
        assert_eq!(
            action_params("child", &state, "send", "hello", "turn")
                .unwrap()
                .0,
            "thread-follower-start-turn"
        );
    }
}
