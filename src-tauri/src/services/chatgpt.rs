use serde_json::{json, Value};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

const MAX_FRAME: usize = 8 * 1024 * 1024;
static APP_TOOLS_GATE: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);

// Use only the caller context supplied by the desktop app. Never invent a task
// identity or search other processes for credentials or private pipe names.
fn context() -> Result<(String, String), String> {
    let pipe = std::env::var("CODEX_APP_TOOLS_PIPE_PATH").map_err(|_| {
        "ChatGPT 接入需要主 App 提供的 App Tools 连接，请从主 App 会话启动悬浮窗".to_string()
    })?;
    let caller = std::env::var("CODEX_THREAD_ID")
        .map_err(|_| "缺少主 App 提供的会话身份，ChatGPT 接入不可用".to_string())?;
    uuid::Uuid::parse_str(&caller).map_err(|_| "主 App 会话身份无效".to_string())?;
    Ok((pipe, caller))
}

async fn exchange<S: AsyncRead + AsyncWrite + Unpin>(
    stream: &mut S,
    id: u32,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let request =
        serde_json::to_vec(&json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}))
            .map_err(|error| error.to_string())?;
    if request.len() > MAX_FRAME {
        return Err("App Tools 请求过大".into());
    }
    stream
        .write_all(&(request.len() as u32).to_le_bytes())
        .await
        .map_err(|error| error.to_string())?;
    stream
        .write_all(&request)
        .await
        .map_err(|error| error.to_string())?;
    let length = stream
        .read_u32_le()
        .await
        .map_err(|error| error.to_string())? as usize;
    if length == 0 || length > MAX_FRAME {
        return Err("App Tools 响应长度无效".into());
    }
    let mut bytes = vec![0; length];
    stream
        .read_exact(&mut bytes)
        .await
        .map_err(|error| error.to_string())?;
    let response: Value = serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
    if response["id"] != id || response["jsonrpc"] != "2.0" {
        return Err("App Tools 响应不匹配".into());
    }
    if !response["error"].is_null() {
        return Err(response["error"]["message"]
            .as_str()
            .unwrap_or("App Tools 请求失败")
            .into());
    }
    response
        .get("result")
        .cloned()
        .ok_or_else(|| "App Tools 响应缺少结果".into())
}

fn decode_result(response: Value) -> Result<Value, String> {
    let texts: Vec<_> = response["contentItems"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|item| item["type"] == "inputText")
        .filter_map(|item| item["text"].as_str())
        .collect();
    if response["success"] != true {
        let error=texts.join("\n");
        return Err(if error.is_empty(){"ChatGPT 操作未完成".into()}else{error});
    }
    texts
        .iter()
        .find_map(|text| serde_json::from_str(text).ok())
        .ok_or_else(|| "ChatGPT 响应格式无效".into())
}

async fn call(tool: &str, arguments: Value) -> Result<Value, String> {
    if !matches!(
        tool,
        "list_threads" | "read_thread" | "send_message_to_thread"
    ) {
        return Err("不支持的 ChatGPT 操作".into());
    }
    let (pipe, caller) = context()?;
    let request = async {
        let _permit = APP_TOOLS_GATE
            .acquire()
            .await
            .map_err(|_| "App Tools 连接已关闭".to_string())?;
        let mut stream = crate::platform::app_tools::connect(&pipe).await?;
        let catalog = exchange(
            &mut stream,
            1,
            "tools/list",
            json!({"threadStartKind":"all"}),
        )
        .await?;
        let entry = catalog["tools"]
            .as_array()
            .and_then(|tools| tools.iter().find(|entry| entry["name"] == tool))
            .ok_or("主 App 未提供此 ChatGPT 操作")?;
        let namespace = entry["namespace"]
            .as_str()
            .ok_or("App Tools 缺少命名空间")?;
        let response = exchange(&mut stream, 2, "tools/call", json!({
            "namespace":namespace,"tool":tool,"arguments":arguments,
            "callerSource":"codex","threadId":caller,"hostId":"local",
            "callId":uuid::Uuid::new_v4().to_string(),
            "turnId":std::env::var("CODEX_TURN_ID").unwrap_or_else(|_|format!("mcp-turn-{}",uuid::Uuid::new_v4()))
        })).await?;
        if tool == "send_message_to_thread" && response["success"] == true {
            return Ok(json!({"accepted":true}));
        }
        decode_result(response)
    };
    tokio::time::timeout(std::time::Duration::from_secs(30), request)
        .await
        .map_err(|_| "ChatGPT 请求超时，结果尚未确认，请刷新会话后再操作".to_string())?
}

#[tauri::command]
pub async fn list_chatgpt_threads(cursor: Option<String>) -> Result<Value, String> {
    let mut arguments = json!({"source":"chatgpt","mode":"history","limit":50});
    if let Some(cursor) = cursor {
        arguments["cursor"] = json!(cursor);
    }
    call("list_threads", arguments).await
}

#[tauri::command]
pub async fn read_chatgpt_thread(
    thread_id: String,
    cursor: Option<String>,
) -> Result<Value, String> {
    uuid::Uuid::parse_str(&thread_id).map_err(|_| "聊天 ID 格式不正确".to_string())?;
    let mut arguments = json!({"threadId":thread_id,"turnLimit":10,"maxOutputCharsPerItem":20000});
    if let Some(cursor) = cursor {
        arguments["cursor"] = json!(cursor);
    }
    let result = call("read_thread", arguments).await?;
    if result["thread"]["kind"] != "chatgpt" || result["thread"]["id"] != thread_id {
        return Err("返回的会话不是所选 ChatGPT 会话".into());
    }
    Ok(result)
}

#[tauri::command]
pub async fn send_chatgpt_message(thread_id: String, text: String) -> Result<Value, String> {
    uuid::Uuid::parse_str(&thread_id).map_err(|_| "聊天 ID 格式不正确".to_string())?;
    if text.trim().is_empty() || text.len() > 100_000 {
        return Err("消息长度无效".into());
    }
    // Check the target type before sending; this adapter never creates a new chat.
    read_chatgpt_thread(thread_id.clone(), None).await?;
    call(
        "send_message_to_thread",
        json!({"threadId":thread_id,"prompt":text}),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tool_results_preserve_errors_and_require_structured_success() {
        assert_eq!(decode_result(json!({"success":true,"contentItems":[{"type":"inputText","text":"{\"threads\":[]}"}]})).unwrap(),json!({"threads":[]}));
        assert_eq!(decode_result(json!({"success":false,"contentItems":[{"type":"inputText","text":"Access denied"}]})).unwrap_err(),"Access denied");
        assert!(decode_result(
            json!({"success":true,"contentItems":[{"type":"inputText","text":"not JSON"}]})
        )
        .is_err());
    }
    #[test]
    #[ignore = "requires a real desktop App Tools caller; read-only"]
    fn live_chatgpt_history() {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                let list = list_chatgpt_threads(None).await.unwrap();
                let id = list["threads"].as_array().unwrap().first().unwrap()["id"]
                    .as_str()
                    .unwrap();
                let history = read_chatgpt_thread(id.into(), None).await.unwrap();
                assert_eq!(history["thread"]["kind"], "chatgpt");
                assert!(history["turns"].is_array());
            });
    }
}
