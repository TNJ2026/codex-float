use super::get_client;
use serde_json::{json, Value};

#[tauri::command]
pub async fn find_running_thread(
    app: tauri::AppHandle,
    thread_ids: Vec<String>,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = get_client(&app)?;
        super::discovery::first_running(thread_ids, |id| {
            let response = client.rpc(
                "thread-owner-discovery",
                json!({"hostId":"local","conversationId":id}),
                1,
                None,
            )?;
            response["handledByClientId"]
                .as_str()
                .map(str::to_owned)
                .ok_or_else(|| "Missing chat owner in Codex response".into())
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn connect_thread(
    app: tauri::AppHandle,
    thread_id: String,
    open_if_needed: Option<bool>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        uuid::Uuid::parse_str(&thread_id).map_err(|_| "聊天 ID 格式不正确".to_string())?;
        let c = get_client(&app)?;
        connect_client(&c, &thread_id, open_if_needed.unwrap_or(false))
    })
    .await
    .map_err(|e| e.to_string())?
}

pub(super) fn connect_client(
    c: &super::client::Client,
    thread_id: &str,
    open_if_needed: bool,
) -> Result<Value, String> {
    // Keep discovery, binding changes and failure cleanup in one transaction.
    // This lock is independent of Bridge's slot and is never taken by shutdown.
    let _connecting = c.connecting.lock().map_err(|_| "聊天连接不可用")?;
    let mut retry_deadline = None;
    let owner = super::discovery::owner_for_connection(
        thread_id,
        open_if_needed,
        |id| {
            let response = c.rpc(
                "thread-owner-discovery",
                json!({"hostId":"local","conversationId":id}),
                1,
                None,
            )?;
            response["handledByClientId"]
                .as_str()
                .map(str::to_owned)
                .ok_or_else(|| "未找到聊天所有者".into())
        },
        |id| crate::platform::shell::open_url(&format!("codex://threads/{id}")),
        || {
            let deadline = *retry_deadline.get_or_insert_with(|| {
                std::time::Instant::now() + std::time::Duration::from_secs(8)
            });
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            if remaining.is_zero() {
                return false;
            }
            std::thread::sleep(remaining.min(std::time::Duration::from_millis(250)));
            std::time::Instant::now() < deadline
        },
    )
    .map_err(|error| {
        if error == "no-client-found" {
            crate::services::ui_language::text(
                "该聊天尚未加载，点击同步即可打开并连接",
                "This chat is not loaded. Click Sync to open and connect it.",
            )
            .to_string()
        } else {
            format!(
                "{}: {error}",
                crate::services::ui_language::text(
                    "查找聊天运行实例失败",
                    "Could not discover the chat owner",
                )
            )
        }
    })?;
    c.unbind()?;
    *c.binding.lock().map_err(|_| "聊天连接不可用")? = Some((thread_id.to_string(), owner.clone()));
    if let Err(error) = c.load_history(thread_id, &owner, false) {
        // Keep the load failure as the user-facing error; an unbind failure would hide it.
        let _ = c.unbind();
        return Err(error);
    }
    Ok(json!({"connected":true}))
}
#[tauri::command]
pub async fn send_prompt(
    app: tauri::AppHandle,
    thread_id: String,
    text: String,
    steer: bool,
    client_message_id: Option<String>,
    attachment_paths: Option<Vec<String>>,
    context_items: Option<Vec<crate::services::context::ContextItem>>,
) -> Result<Value, String> {
    if text.len() > 100_000 {
        return Err("提示词不能超过 100000 字节".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let c = get_client(&app)?;
        let binding = c.bound()?.ok_or("请先连接聊天")?;
        if binding.0 != thread_id { return Err("聊天已切换，请重新连接".into()); }
        let context_items = context_items.unwrap_or_default();
        let (thread_references, additional_context) = crate::services::context::thread_reference_context(&context_items, &thread_id)?;
        let (prompt, context_inputs, context_attachments) = crate::services::context::prepare(&text, &context_items)?;
        let (mut input, mut attachments, mut context) = crate::services::attachments::prompt_parts(&prompt, attachment_paths.unwrap_or_default())?;
        input.as_array_mut().ok_or("上下文输入无效")?.extend(context_inputs);
        attachments.as_array_mut().ok_or("上下文附件无效")?.extend(context_attachments.clone());
        context["fileAttachments"].as_array_mut().ok_or("文件上下文无效")?.extend(context_attachments);
        context["contextItems"] = json!(context_items);
        context["threadReferences"] = json!(thread_references);
        context["prompt"] = json!(text);
        let message_id = match client_message_id {
            Some(id) => uuid::Uuid::parse_str(&id).map_err(|_| "消息 ID 格式不正确".to_string())?.to_string(),
            None => uuid::Uuid::new_v4().to_string(),
        };
        let restore = json!({"id":message_id,"text":text,"context":context});
        let (method, version, mut params) = if steer {
            ("thread-follower-steer-turn", 1, json!({"conversationId":thread_id,"input":input,"restoreMessage":restore,"attachments":attachments,"clientUserMessageId":message_id}))
        } else {
            ("thread-follower-start-turn", 2, json!({"conversationId":thread_id,"turnStart":{"request":{"threadId":thread_id,"input":input,"clientUserMessageId":message_id,"turnTrigger":"composer"},"context":{"commentAttachments":[],"attachments":attachments,"restoreMessage":restore}}}))
        };
        if !additional_context.is_null() {
            if steer { params["additionalContext"] = additional_context; }
            else { params["turnStart"]["request"]["additionalContext"] = additional_context; }
        }
        let r = c.rpc(method, params, version, Some(&binding.1))?;
        Ok(r["result"].clone())
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn reply_interaction(
    app: tauri::AppHandle,
    thread_id: String,
    request_id: Value,
    request_method: String,
    payload: Value,
) -> Result<Value, String> {
    if payload.to_string().len() > 100_000 {
        return Err("回复内容过长".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let c = get_client(&app)?;
        let binding = c.bound()?.ok_or("请先连接聊天")?;
        if binding.0 != thread_id {
            return Err("聊天已切换，请重新连接".into());
        }
        let (method, params) = crate::services::interactions::reply_request(
            &thread_id,
            request_id,
            &request_method,
            payload,
        )?;
        let result = c.rpc(method, params, 1, Some(&binding.1))?;
        Ok(result["result"].clone())
    })
    .await
    .map_err(|e| e.to_string())?
}
