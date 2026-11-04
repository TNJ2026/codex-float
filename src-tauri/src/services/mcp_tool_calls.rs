use super::mcp_apps::{AppResource, McpAppsState, ResourceReader};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{mpsc, Mutex},
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};

struct Pending {
    token: String,
    method: String,
    reply: mpsc::Sender<Value>,
}
#[derive(Default)]
pub struct McpToolState(Mutex<HashMap<String, Pending>>);

fn visible(tool: &Value) -> bool {
    if tool["_meta"].get("openai/fileParams").is_some() {
        return false;
    }
    if let Some(visibility) = tool["_meta"]["ui"].get("visibility") {
        return visibility
            .as_array()
            .is_some_and(|values| values.iter().any(|value| value == "app"));
    }
    // Legacy OpenAI widgets opt in explicitly; standard MCP Apps default to both audiences.
    if let Some(accessible) = tool["_meta"].get("openai/widgetAccessible") {
        return accessible == true;
    }
    true
}

fn identity(tool: &Value) -> (Option<&str>, Option<&str>) {
    let meta = &tool["_meta"];
    let connector = meta["connectorId"]
        .as_str()
        .or_else(|| meta["connector_id"].as_str());
    let target = meta["_codex_apps"]["resource_uri"]
        .as_str()
        .and_then(|uri| {
            let parts: Vec<_> = uri.split('/').collect();
            (parts.len() == 4 && parts[0].is_empty() && Some(parts[1]) == connector)
                .then(|| parts[2])
        })
        .or_else(|| meta["link_id"].as_str());
    (connector, target)
}
fn allowed(resource: &AppResource, tool: &Value) -> bool {
    if !visible(tool) {
        return false;
    }
    if resource.server != "codex_apps" {
        return true;
    }
    if !tool["_meta"]["ui"].is_object() && tool["_meta"]["openai/widgetAccessible"] != true {
        return false;
    }
    let (connector, target) = identity(tool);
    let Some(expected) = resource.connector_id.as_deref() else {
        return false;
    };
    if connector != Some(expected) {
        return false;
    }
    match resource
        .target
        .as_ref()
        .and_then(|scope| scope["linkId"].as_str())
    {
        Some(expected) => target == Some(expected),
        None => {
            target.is_none()
                || tool["_meta"]["_codex_apps"]["synthetic_link"] == true
                || target.is_some_and(|id| id.starts_with("synthetic_link::"))
        }
    }
}
fn resolve_tool<'a>(
    resource: &AppResource,
    tools: &'a [Value],
    name: &str,
) -> Result<&'a Value, String> {
    let candidates: Vec<_> = tools
        .iter()
        .filter(|tool| allowed(resource, tool))
        .collect();
    if let Some(tool) = candidates.iter().find(|tool| tool["name"] == name) {
        return Ok(tool);
    }
    if resource.server == "codex_apps" {
        let aliases: Vec<_> = candidates
            .into_iter()
            .filter(|tool| {
                let uri = tool["_meta"]["_codex_apps"]["resource_uri"]
                    .as_str()
                    .unwrap_or_default();
                !uri.is_empty() && (uri == name || uri.rsplit('/').next() == Some(name))
                    || tool["title"] == name
            })
            .collect();
        if aliases.len() == 1 {
            return Ok(aliases[0]);
        }
    }
    Err("该工具不存在，或不在此卡片允许调用的服务与账号范围内".into())
}
fn call_params(
    resource: &AppResource,
    tool: &Value,
    thread: &str,
    mut arguments: Value,
) -> Result<Value, String> {
    if !arguments.is_object() || arguments.to_string().len() > 65536 {
        return Err("工具参数必须是 JSON 对象且不超过 64 KB".into());
    }
    if resource.server == "codex_apps" {
        if let Some(target) = resource
            .target
            .as_ref()
            .and_then(|scope| scope["linkId"].as_str())
        {
            if arguments
                .get("link_id")
                .is_some_and(|value| value != target)
            {
                return Err("卡片不能切换工具调用的账号".into());
            }
            if tool["_meta"]["_codex_apps"]["requires_explicit_link_id"] == true {
                arguments["link_id"] = json!(target);
            }
        } else if arguments
            .get("link_id")
            .is_some_and(|value| value != &tool["_meta"]["link_id"])
        {
            return Err("卡片不能切换默认工具连接的账号".into());
        }
    }
    let mut meta = json!({"threadId":thread,"thread_id":thread});
    for key in ["connector_name", "_codex_apps"] {
        if let Some(value) = tool["_meta"].get(key) {
            meta[key] = value.clone();
        }
    }
    Ok(
        json!({"threadId":thread,"server":resource.server,"tool":tool["name"],"arguments":arguments,"_meta":meta}),
    )
}
fn inventory(
    reader: &mut ResourceReader,
    resource: &AppResource,
    thread: &str,
    guard: &dyn Fn() -> Result<(), String>,
    interactive: &mut dyn FnMut(&Value) -> Result<Value, String>,
) -> Result<Vec<Value>, String> {
    let mut cursor = Value::Null;
    for _ in 0..32 {
        let result = reader.request_guarded(
            "mcpServerStatus/list",
            json!({"threadId":thread,"serverName":resource.server,"cursor":cursor}),
            Duration::from_secs(25),
            guard,
            interactive,
        )?;
        if let Some(server) = result["data"].as_array().and_then(|servers| {
            servers
                .iter()
                .find(|server| server["name"] == resource.server)
        }) {
            if let Some(error) = server["toolsError"].as_str() {
                return Err(format!("无法读取卡片工具列表：{error}"));
            }
            return server["tools"]
                .as_object()
                .map(|tools| tools.values().cloned().collect())
                .ok_or_else(|| "卡片服务未提供工具列表".into());
        }
        cursor = result["nextCursor"].clone();
        if cursor.is_null() {
            break;
        }
    }
    Err("卡片所属 MCP 服务不可用，请检查主 App 中的连接".into())
}

fn wait_for_approval(
    app: &tauri::AppHandle,
    token: &str,
    resource: &AppResource,
    message: &Value,
    guard: &dyn Fn() -> Result<(), String>,
) -> Result<Value, String> {
    if message["method"] != "mcpServer/elicitation/request" {
        return Err("卡片工具连接不支持此交互请求".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = mpsc::channel();
    {
        let state = app.state::<McpToolState>();
        let mut pending = state.0.lock().map_err(|_| "卡片审批不可用")?;
        if pending.len() >= 32 {
            return Err("等待处理的卡片请求过多".into());
        }
        pending.insert(
            id.clone(),
            Pending {
                token: token.into(),
                method: message["method"].as_str().unwrap().into(),
                reply: tx,
            },
        );
    }
    let result = (|| {
        app.emit("mcp-app-interaction", json!({"token":token,"threadId":resource.thread_id,"request":{"id":id,"method":message["method"],"params":message["params"]}})).map_err(|error| error.to_string())?;
        let deadline = Instant::now() + Duration::from_secs(180);
        loop {
            guard()?;
            if Instant::now() >= deadline {
                return Ok(json!({"action":"cancel"}));
            }
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(response) => return Ok(response),
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(_) => return Ok(json!({"action":"cancel"})),
            }
        }
    })();
    if let Ok(mut pending) = app.state::<McpToolState>().0.lock() {
        pending.remove(&id);
    }
    let _ = app.emit(
        "mcp-app-interaction",
        json!({"token":token,"threadId":resource.thread_id,"resolvedId":id}),
    );
    result
}

#[tauri::command]
pub async fn mcp_app_tool(
    app: tauri::AppHandle,
    token: String,
    action: String,
    name: Option<String>,
    arguments: Option<Value>,
) -> Result<Value, String> {
    if !matches!(action.as_str(), "list" | "call") {
        return Err("不支持的卡片工具操作".into());
    }
    if action == "call"
        && name.as_deref().is_none_or(|name| {
            name.is_empty() || name.len() > 512 || name.chars().any(char::is_control)
        })
    {
        return Err("工具名称无效".into());
    }
    let arguments = arguments.unwrap_or_else(|| json!({}));
    if !arguments.is_object() || arguments.to_string().len() > 65536 {
        return Err("工具参数必须是 JSON 对象且不超过 64 KB".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<McpAppsState>();
        let resource = state.scope(&token)?;
        let client = crate::codex::get_client(&app)?;
        let binding = client.binding.lock().map_err(|_| "聊天连接不可用")?.clone().ok_or("请先连接聊天")?;
        if binding.0 != resource.thread_id { return Err("聊天已切换，未执行卡片操作".into()); }
        let guard = || {
            if state.scope(&token).is_err() || client.binding.lock().map_err(|_| "聊天连接不可用")?.as_ref() != Some(&binding) { return Err("卡片已关闭或聊天已切换，请检查操作状态，避免重复提交".into()); }
            Ok(())
        };
        guard()?;
        let connection = state.connection(&resource)?;
        let deadline = Instant::now() + Duration::from_secs(25);
        let mut reader = loop {
            guard()?;
            match connection.try_lock() {
                Ok(reader) => break reader,
                Err(std::sync::TryLockError::Poisoned(_)) => return Err("卡片工具连接不可用".into()),
                Err(std::sync::TryLockError::WouldBlock) => {
                    if Instant::now() >= deadline { return Err("此聊天的卡片工具仍在执行，请稍后操作".into()); }
                    std::thread::sleep(Duration::from_millis(100));
                }
            }
        };
        let result = (|| {
            let thread = reader.thread()?;
            let mut interactive = |message: &Value| wait_for_approval(&app, &token, &resource, message, &guard);
            let tools = inventory(&mut reader, &resource, &thread, &guard, &mut interactive)?;
            if action == "list" { return Ok(json!({"tools":tools.into_iter().filter(|tool| allowed(&resource, tool)).collect::<Vec<_>>()})); }
            let tool = resolve_tool(&resource, &tools, name.as_deref().unwrap())?;
            let params = call_params(&resource, tool, &thread, arguments)?;
            // Each button request is dispatched once. Never retry an uncertain tool execution.
            let result = reader.request_guarded("mcpServer/tool/call", params, Duration::from_secs(180), &guard, &mut interactive)?;
            guard()?;
            if !result["content"].is_array() { return Err("工具返回格式无效，执行结果请检查服务状态".into()); }
            Ok(result)
        })();
        if result.is_err() { state.discard_connection(&resource, &connection); }
        result
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn reply_mcp_app_request(
    app: tauri::AppHandle,
    token: String,
    request_id: String,
    payload: Value,
) -> Result<(), String> {
    let resource = app.state::<McpAppsState>().scope(&token)?;
    let client = crate::codex::get_client(&app)?;
    if !client
        .binding
        .lock()
        .map_err(|_| "聊天连接不可用")?
        .as_ref()
        .is_some_and(|binding| binding.0 == resource.thread_id)
    {
        return Err("聊天已切换，未提交回复".into());
    }
    if payload.to_string().len() > 65536 {
        return Err("回复内容过大".into());
    }
    let state = app.state::<McpToolState>();
    let mut pending = state.0.lock().map_err(|_| "卡片审批不可用")?;
    let request = pending
        .get(&request_id)
        .filter(|request| request.token == token)
        .ok_or("请求已结束或不属于此卡片")?;
    let (_, params) = super::interactions::reply_request(
        &resource.thread_id,
        json!(request_id),
        &request.method,
        payload,
    )?;
    request
        .reply
        .send(params["response"].clone())
        .map_err(|_| "卡片请求已结束")?;
    pending.remove(&request_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn resource(server: &str) -> AppResource {
        serde_json::from_value(json!({"threadId":"01a1a396-76ee-7073-a74c-01f7dc0f4bcf","callId":"source-call","server":server,"resourceUri":"ui://example","connectorId":"app","target":{"connectorId":"app","linkId":"account-a"}})).unwrap()
    }
    fn descriptor(name: &str, connector: &str, account: &str) -> Value {
        json!({"name":name,"inputSchema":{"type":"object"},"_meta":{"connector_id":connector,"link_id":account,"connector_name":"Test app","_codex_apps":{"resource_uri":format!("/{connector}/{account}/refresh"),"requires_explicit_link_id":true},"ui":{"visibility":["app"]}}})
    }
    #[test]
    fn app_tools_are_limited_to_their_server_visibility_connector_and_account() {
        let standard = resource("example");
        assert!(allowed(&standard, &json!({"name":"default"})));
        assert!(allowed(
            &standard,
            &json!({"name":"app-only","_meta":{"ui":{"visibility":["app"]}}})
        ));
        for tool in [
            json!({"_meta":{"ui":{"visibility":["model"]}}}),
            json!({"_meta":{"openai/widgetAccessible":false}}),
            json!({"_meta":{"openai/fileParams":[]}}),
        ] {
            assert!(!allowed(&standard, &tool));
        }
        let scoped = resource("codex_apps");
        let tools = vec![
            descriptor("a", "app", "account-a"),
            descriptor("b", "app", "account-b"),
            descriptor("c", "other", "account-a"),
        ];
        assert_eq!(
            tools.iter().filter(|tool| allowed(&scoped, tool)).count(),
            1
        );
        assert_eq!(
            resolve_tool(&scoped, &tools, "refresh").unwrap()["name"],
            "a"
        );
        assert!(resolve_tool(&scoped, &tools, "b").is_err());
        let params =
            call_params(&scoped, &tools[0], "temporary-thread", json!({"value":1})).unwrap();
        assert_eq!(params["server"], "codex_apps");
        assert_eq!(params["arguments"]["link_id"], "account-a");
        assert_eq!(params["_meta"]["thread_id"], "temporary-thread");
        assert_eq!(params["_meta"]["connector_name"], "Test app");
        assert!(call_params(
            &scoped,
            &tools[0],
            "temporary-thread",
            json!({"link_id":"account-b"})
        )
        .is_err());
        let mut implicit = scoped.clone();
        implicit.target = Some(json!({"connectorId":"app","linkId":null}));
        let default = json!({"name":"default","_meta":{"connector_id":"app","ui":{}}});
        assert!(allowed(&implicit, &default));
        assert!(!allowed(&implicit, &tools[0]));
        assert!(call_params(
            &implicit,
            &default,
            "temporary-thread",
            json!({"link_id":"account-b"})
        )
        .is_err());
    }
    #[test]
    fn tool_transport_handles_form_approvals_and_cancels_waits_without_resending() {
        let mut command = std::process::Command::new("node");
        crate::platform::process::configure(&mut command);
        command.arg(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../scripts/fixtures/mcp-tool-server.mjs"),
        );
        let mut reader = ResourceReader::from_command(command).unwrap();
        let thread = reader.thread().unwrap();
        assert_eq!(thread, "ephemeral-test");
        let guard = || Ok(());
        let mut approvals = 0;
        let mut interactive = |request: &Value| {
            approvals += 1;
            assert_eq!(request["method"], "mcpServer/elicitation/request");
            Ok(json!({"action":"accept","content":{"confirm":true}}))
        };
        let tools = inventory(
            &mut reader,
            &resource("example"),
            &thread,
            &guard,
            &mut interactive,
        )
        .unwrap();
        assert_eq!(
            tools
                .iter()
                .filter(|tool| allowed(&resource("example"), tool))
                .count(),
            1
        );
        let tool = resolve_tool(&resource("example"), &tools, "read").unwrap();
        let params = call_params(&resource("example"), tool, &thread, json!({})).unwrap();
        let result = reader
            .request_guarded(
                "mcpServer/tool/call",
                params,
                Duration::from_secs(3),
                &guard,
                &mut interactive,
            )
            .unwrap();
        assert_eq!(approvals, 1);
        assert_eq!(
            result["structuredContent"]["approval"]["content"]["confirm"],
            true
        );
        assert_eq!(result["_meta"]["receipt"], "test");
        let start = Instant::now();
        let guard = || {
            if start.elapsed() > Duration::from_millis(150) {
                Err("scope changed".into())
            } else {
                Ok(())
            }
        };
        let error = reader
            .request_guarded(
                "mcpServer/tool/call",
                json!({"arguments":{"hang":true}}),
                Duration::from_secs(3),
                &guard,
                &mut |_| panic!("no approval expected"),
            )
            .unwrap_err();
        assert_eq!(error, "scope changed");
        assert!(start.elapsed() < Duration::from_secs(1));
    }
    #[test]
    #[ignore = "Calls a read-only MCP tool using a temporary connection; no model turn or persistent chat is created"]
    fn live_read_only_app_tool() {
        let resource = resource("cities-skylines2");
        let mut reader = ResourceReader::open(None).unwrap();
        let thread = reader.thread().unwrap();
        let mut interactive =
            |_: &Value| Err("Read-only verification does not accept interactive approvals".into());
        let tools = inventory(
            &mut reader,
            &resource,
            &thread,
            &|| Ok(()),
            &mut interactive,
        )
        .unwrap();
        let tool = resolve_tool(&resource, &tools, "list_zone_types").unwrap();
        assert_eq!(tool["annotations"]["readOnlyHint"], true);
        let params = call_params(&resource, tool, &thread, json!({})).unwrap();
        let result = reader
            .request_guarded(
                "mcpServer/tool/call",
                params,
                Duration::from_secs(25),
                &|| Ok(()),
                &mut interactive,
            )
            .unwrap();
        assert_ne!(result["isError"], true);
        assert!(result["content"].is_array());
        assert!(!result["structuredContent"].is_null());
        println!(
            "Read-only MCP call returned {} content blocks",
            result["content"].as_array().unwrap().len()
        );
    }
}
