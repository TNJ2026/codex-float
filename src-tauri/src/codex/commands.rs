use super::get_client;
use serde_json::{json, Value};

#[tauri::command]
pub async fn connect_thread(app: tauri::AppHandle, thread_id: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        uuid::Uuid::parse_str(&thread_id).map_err(|_| "聊天 ID 格式不正确".to_string())?;
        let c = get_client(&app)?;
        let r = c
            .rpc(
                "thread-owner-discovery",
                json!({"hostId":"local","conversationId":thread_id}),
                1,
                None,
            )
            .map_err(|_| {
                "未找到运行中的聊天，请先在 Codex 主窗口打开该聊天，再点击连接".to_string()
            })?;
        let owner = r["handledByClientId"]
            .as_str()
            .ok_or("未找到聊天所有者")?
            .to_string();
        c.unbind();
        *c.binding.lock().unwrap() = Some((thread_id.clone(), owner.clone()));
        c.follow(&thread_id, &owner, true)?;
        if let Err(error) = c.rpc(
            "thread-follower-load-complete-history",
            json!({"conversationId":thread_id}),
            1,
            Some(&owner),
        ) {
            c.unbind();
            return Err(error);
        }
        Ok(json!({"connected":true}))
    })
    .await
    .map_err(|e| e.to_string())?
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
        let binding = c.binding.lock().unwrap().clone().ok_or("请先连接聊天")?;
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
        let binding = c.binding.lock().unwrap().clone().ok_or("请先连接聊天")?;
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
